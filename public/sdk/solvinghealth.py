# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Blaine Warkentine. Licensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
"""
SolvingHealth Public Data API — Python SDK

    from solvinghealth import SolvingHealth
    sh = SolvingHealth()
    for p in sh.providers.search(state="CO", taxonomy="Orthopaedic Surgery")["results"]:
        print(p["npi"], p["name"])

Standard library only — no pip install, no key. The API is read-only public
federal data and holds no PHI.

Every response carries `source`, `source_url` and `retrieved_at`, so any fact
you get back can be re-derived from the government source without trusting us.

Download:  https://solvinghealth.com/sdk/solvinghealth.py
Docs:      https://solvinghealth.com/developers
"""

from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

__version__ = "1.0.0"
DEFAULT_BASE = "https://solvinghealth.com/api/v1"
_RETRYABLE = {429, 502, 503, 504}


def _ssl_context() -> ssl.SSLContext:
    """A verifying TLS context that still works on a stock python.org macOS build.

    Those builds ship without a CA bundle wired into OpenSSL, so every HTTPS call
    dies with CERTIFICATE_VERIFY_FAILED until the user runs Install Certificates.command.
    If `certifi` is importable we use its bundle. Verification is never disabled.
    """
    ctx = ssl.create_default_context()
    if ctx.cert_store_stats().get("x509_ca", 0) == 0:
        try:
            import certifi

            ctx.load_verify_locations(cafile=certifi.where())
        except Exception:
            pass
    return ctx


class SolvingHealthError(Exception):
    """Raised for any non-2xx response; carries the API's structured error."""

    def __init__(self, status: int, body: Optional[dict], url: str):
        self.status = status
        self.body = body or {}
        self.code = self.body.get("error", "request_failed")
        self.detail = self.body.get("detail")
        self.url = url
        msg = f"[{status}] {self.code}"
        if self.detail:
            msg += f": {self.detail}"
        super().__init__(msg)

    @property
    def retryable(self) -> bool:
        return self.status in _RETRYABLE


class _Namespace:
    def __init__(self, client: "SolvingHealth"):
        self._c = client


class _Providers(_Namespace):
    def search(self, **params: Any) -> Dict[str, Any]:
        """Search the NPPES NPI registry.

        Keywords: state, city, postal_code, taxonomy, first_name, last_name, organization, limit.
        postal_code is a 5-digit ZIP (or ZIP+4) and matches practice locations.
        """
        return self._c.get("/providers/search", **params)

    def get(self, npi: str) -> Dict[str, Any]:
        """One provider by 10-digit NPI."""
        return self._c.get(f"/providers/{urllib.parse.quote(str(npi))}")


class _Clearances(_Namespace):
    def search(self, **params: Any) -> Dict[str, Any]:
        """510(k) device clearances. Keywords: q, applicant, since, limit."""
        return self._c.get("/clearances/search", **params)


class _Devices(_Namespace):
    def recalls(self, **params: Any) -> Dict[str, Any]:
        """Device recall records. Keywords: q, limit."""
        return self._c.get("/devices/recalls", **params)

    def events(self, **params: Any) -> Dict[str, Any]:
        """MAUDE adverse event reports. Keywords: q, limit."""
        return self._c.get("/devices/events", **params)


class _Labels(_Namespace):
    def search(self, **params: Any) -> Dict[str, Any]:
        """Structured drug labeling. Keywords: q, brand, generic, limit."""
        return self._c.get("/labels/search", **params)


class _Trials(_Namespace):
    def search(self, **params: Any) -> Dict[str, Any]:
        """Registered clinical studies. Keywords: condition, intervention, location, status, limit."""
        return self._c.get("/trials/search", **params)


class _Hospitals(_Namespace):
    def search(self, **params: Any) -> Dict[str, Any]:
        """CMS Hospital General Information. Keywords: state, city, name, limit."""
        return self._c.get("/hospitals/search", **params)


class SolvingHealth:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE,
        timeout: float = 15.0,
        retries: int = 2,
        ssl_context: Optional[ssl.SSLContext] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self._ssl = ssl_context or _ssl_context()
        self.timeout = timeout
        self.retries = retries
        self.providers = _Providers(self)
        self.clearances = _Clearances(self)
        self.devices = _Devices(self)
        self.labels = _Labels(self)
        self.trials = _Trials(self)
        self.hospitals = _Hospitals(self)

    def index(self) -> Dict[str, Any]:
        """The service index: every endpoint, whether it is live, and its upstream."""
        return self.get("")

    def health(self) -> Dict[str, Any]:
        """Liveness plus an upstream reachability probe."""
        return self.get("/health")

    def get(self, path: str, **params: Any) -> Dict[str, Any]:
        """Low-level request. Most callers should use the namespaced helpers."""
        clean = {k: v for k, v in params.items() if v is not None and v != ""}
        qs = urllib.parse.urlencode(clean)
        url = f"{self.base_url}{path}" + (f"?{qs}" if qs else "")
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": f"solvinghealth-python/{__version__}",
            },
        )

        last: Optional[Exception] = None
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout, context=self._ssl) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                raw = e.read().decode("utf-8", "replace")
                try:
                    body = json.loads(raw)
                except ValueError:
                    body = None
                err = SolvingHealthError(e.code, body, url)
                if err.retryable and attempt < self.retries:
                    last = err
                    time.sleep(0.4 * (attempt + 1))
                    continue
                raise err from None
            except urllib.error.URLError as e:
                if isinstance(e.reason, ssl.SSLCertVerificationError):
                    raise SolvingHealthError(
                        0,
                        {
                            "error": "tls_verification_failed",
                            "detail": (
                                "Your Python has no CA bundle. On macOS run "
                                "'/Applications/Python 3.x/Install Certificates.command', "
                                "or 'pip install certifi' and this SDK will pick it up."
                            ),
                        },
                        url,
                    ) from None
                last = e
                if attempt < self.retries:
                    time.sleep(0.4 * (attempt + 1))
                    continue
                raise
            except TimeoutError as e:
                last = e
                if attempt < self.retries:
                    time.sleep(0.4 * (attempt + 1))
                    continue
                raise
        if last:
            raise last
        raise RuntimeError("unreachable")


def _cli() -> None:
    """python3 solvinghealth.py trials/search condition='knee osteoarthritis' limit=3"""
    import sys

    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(_cli.__doc__)
        print("\nEndpoints:")
        for e in SolvingHealth().index()["endpoints"]:
            flag = "live" if e.get("live") else "not implemented"
            print(f"  {e['path']:<24} {flag:<16} {e['desc']}")
        return
    path = "/" + args[0].lstrip("/")
    params = dict(a.split("=", 1) for a in args[1:] if "=" in a)
    print(json.dumps(SolvingHealth().get(path, **params), indent=2))


if __name__ == "__main__":
    _cli()
