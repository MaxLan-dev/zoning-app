from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urldefrag, urljoin, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup


@dataclass(frozen=True)
class ScrapedLink:
    url: str
    text: str


@dataclass(frozen=True)
class ScrapePageResult:
    source_url: str
    resolved_url: str
    title: str | None
    links: list[ScrapedLink]

    def as_json(self, *, max_links: int | None = None) -> dict[str, object]:
        links = self.links if max_links is None else self.links[:max_links]
        return {
            "sourceUrl": self.source_url,
            "resolvedUrl": self.resolved_url,
            "title": self.title,
            "linkCount": len(links),
            "links": [{"url": link.url, "text": link.text} for link in links],
        }


@dataclass(frozen=True)
class GeoJSONResult:
    source_url: str
    geojson_url: str
    feature_collection: dict[str, Any]

    def as_json(
        self,
        *,
        max_features: int | None = None,
        property_keys: tuple[str, ...] = (),
    ) -> dict[str, object]:
        features_raw = self.feature_collection.get("features", [])
        features: list[dict[str, Any]] = [
            feature for feature in features_raw if isinstance(feature, dict)
        ]
        if max_features is not None:
            features = features[:max_features]

        if property_keys:
            allowed = {key.lower() for key in property_keys}
            features = [
                {
                    **feature,
                    "properties": {
                        key: value
                        for key, value in (feature.get("properties") or {}).items()
                        if key.lower() in allowed
                    },
                }
                for feature in features
            ]

        return {
            "sourceUrl": self.source_url,
            "geojsonUrl": self.geojson_url,
            "type": "FeatureCollection",
            "featureCount": len(features),
            "features": features,
            "bbox": self.feature_collection.get("bbox"),
        }


class MunicipalWebScraper:
    def __init__(self, timeout_seconds: float = 20.0):
        self._client = httpx.Client(
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=True,
            headers={"User-Agent": "zoning-app-scraper/0.1"},
        )

    def scrape_links(
        self,
        url: str,
        *,
        allowed_domains: set[str] | None = None,
        include_patterns: tuple[str, ...] = (),
        exclude_patterns: tuple[str, ...] = (),
    ) -> ScrapePageResult:
        response = self._client.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        title_node = soup.title.string if soup.title and soup.title.string else None
        links = self._extract_links(
            soup=soup,
            base_url=str(response.url),
            allowed_domains=allowed_domains,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
        )
        return ScrapePageResult(
            source_url=url,
            resolved_url=str(response.url),
            title=title_node.strip() if title_node else None,
            links=links,
        )

    def discover_geojson_urls(
        self,
        url: str,
        *,
        allowed_domains: set[str] | None = None,
    ) -> list[str]:
        response = self._client.get(url)
        response.raise_for_status()
        resolved_url = str(response.url)
        metadata_candidates = self._derive_arcgis_query_urls(
            service_url=resolved_url,
            payload=_try_parse_json(response),
            allowed_domains=allowed_domains,
        )
        if metadata_candidates:
            return metadata_candidates
        soup = BeautifulSoup(response.text, "html.parser")
        return self._extract_geojson_candidates(
            soup=soup,
            base_url=resolved_url,
            allowed_domains=allowed_domains,
        )

    def scrape_geojson(
        self,
        *,
        source_url: str,
        geojson_url: str | None = None,
        allowed_domains: set[str] | None = None,
        paginate: bool = True,
        page_size: int | None = None,
        max_pages: int = 25,
    ) -> GeoJSONResult:
        candidate_urls = (
            [geojson_url]
            if geojson_url is not None
            else self.discover_geojson_urls(
                source_url,
                allowed_domains=allowed_domains,
            )
        )
        if not candidate_urls:
            raise ValueError("No GeoJSON URLs were discovered for the provided source URL")

        attempted_urls: set[str] = set()
        for candidate_url in candidate_urls:
            expanded_urls = self._expand_geojson_candidates(
                candidate_url,
                allowed_domains=allowed_domains,
            )
            for expanded_url in expanded_urls:
                if expanded_url in attempted_urls:
                    continue
                attempted_urls.add(expanded_url)

                parsed = urlparse(expanded_url)
                if allowed_domains and parsed.netloc.lower() not in allowed_domains:
                    continue

                try:
                    payload = self._fetch_geojson_payload(
                        expanded_url,
                        paginate=paginate,
                        page_size=page_size,
                        max_pages=max_pages,
                    )
                except (httpx.HTTPError, ValueError):
                    continue

                feature_collection = _coerce_feature_collection(payload)
                if feature_collection is not None:
                    return GeoJSONResult(
                        source_url=source_url,
                        geojson_url=expanded_url,
                        feature_collection=feature_collection,
                    )

        raise ValueError("No valid GeoJSON FeatureCollection payload was found")

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> MunicipalWebScraper:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    @staticmethod
    def _extract_links(
        *,
        soup: BeautifulSoup,
        base_url: str,
        allowed_domains: set[str] | None,
        include_patterns: tuple[str, ...],
        exclude_patterns: tuple[str, ...],
    ) -> list[ScrapedLink]:
        links: list[ScrapedLink] = []
        seen: set[str] = set()

        for anchor in soup.select("a[href]"):
            href = anchor.get("href")
            if not href:
                continue

            normalized_url = _normalize_url(base_url=base_url, href=href)
            if normalized_url is None or normalized_url in seen:
                continue

            parsed = urlparse(normalized_url)
            if allowed_domains and parsed.netloc.lower() not in allowed_domains:
                continue
            if include_patterns and not _matches_any(normalized_url, include_patterns):
                continue
            if exclude_patterns and _matches_any(normalized_url, exclude_patterns):
                continue

            seen.add(normalized_url)
            links.append(
                ScrapedLink(
                    url=normalized_url,
                    text=" ".join(anchor.get_text(" ", strip=True).split()),
                )
            )

        return links

    @staticmethod
    def _extract_geojson_candidates(
        *,
        soup: BeautifulSoup,
        base_url: str,
        allowed_domains: set[str] | None,
    ) -> list[str]:
        candidates: list[str] = []
        seen: set[str] = set()

        for anchor in soup.select("a[href]"):
            href = anchor.get("href")
            if not href:
                continue
            normalized = _normalize_url(base_url=base_url, href=href)
            if not normalized or normalized in seen:
                continue
            if not _looks_like_geojson_url(normalized):
                continue
            parsed = urlparse(normalized)
            if allowed_domains and parsed.netloc.lower() not in allowed_domains:
                continue
            seen.add(normalized)
            candidates.append(normalized)

        for script in soup.select("script"):
            script_text = script.string or script.get_text(strip=False) or ""
            if not script_text:
                continue
            for match in re.findall(r"https?://[^\s\"']+", script_text):
                normalized, _fragment = urldefrag(match.rstrip(".,);"))
                parsed = urlparse(normalized)
                if normalized in seen or parsed.scheme not in {"http", "https"}:
                    continue
                if allowed_domains and parsed.netloc.lower() not in allowed_domains:
                    continue
                if not _looks_like_geojson_url(normalized):
                    continue
                seen.add(normalized)
                candidates.append(normalized)

        return candidates

    def _fetch_json(self, url: str) -> object:
        response = self._client.get(url)
        response.raise_for_status()
        return response.json()

    def _expand_geojson_candidates(
        self,
        url: str,
        *,
        allowed_domains: set[str] | None,
    ) -> list[str]:
        parsed = urlparse(url)
        if allowed_domains and parsed.netloc.lower() not in allowed_domains:
            return []
        if _looks_like_arcgis_query_url(url):
            return [url]
        if not _looks_like_arcgis_metadata_url(url):
            return [url]
        payload = self._fetch_json(url)
        derived = self._derive_arcgis_query_urls(
            service_url=url,
            payload=payload,
            allowed_domains=allowed_domains,
        )
        if derived:
            return derived
        return [url]

    def _fetch_geojson_payload(
        self,
        url: str,
        *,
        paginate: bool,
        page_size: int | None,
        max_pages: int,
    ) -> object:
        if paginate and _looks_like_arcgis_query_url(url):
            return self._fetch_arcgis_geojson_pages(
                url,
                page_size=page_size,
                max_pages=max_pages,
            )
        return self._fetch_json(url)

    def _fetch_arcgis_geojson_pages(
        self,
        url: str,
        *,
        page_size: int | None,
        max_pages: int,
    ) -> dict[str, Any]:
        if max_pages < 1:
            raise ValueError("`max_pages` must be at least 1")

        parsed = urlparse(url)
        base_params = dict(parse_qsl(parsed.query, keep_blank_values=True))

        request_page_size = (
            page_size
            or _coerce_positive_int(base_params.get("resultRecordCount"))
            or 2000
        )
        current_offset = _coerce_non_negative_int(base_params.get("resultOffset")) or 0
        features: list[dict[str, Any]] = []
        base_collection: dict[str, Any] | None = None

        for _page in range(max_pages):
            page_params = dict(base_params)
            page_params["f"] = "geojson"
            page_params["resultRecordCount"] = str(request_page_size)
            page_params["resultOffset"] = str(current_offset)
            page_url = _replace_query_params(parsed=parsed, params=page_params)

            payload = self._fetch_json(page_url)
            feature_collection = _coerce_feature_collection(payload)
            if feature_collection is None:
                raise ValueError("ArcGIS paged response was not a GeoJSON FeatureCollection")

            if base_collection is None:
                base_collection = {
                    key: value
                    for key, value in feature_collection.items()
                    if key != "features"
                }

            page_features = feature_collection.get("features", [])
            if isinstance(page_features, list):
                features.extend(
                    feature for feature in page_features if isinstance(feature, dict)
                )

            exceeded_transfer_limit = bool(feature_collection.get("exceededTransferLimit"))
            feature_count = len(page_features) if isinstance(page_features, list) else 0

            if feature_count == 0:
                break
            if feature_count < request_page_size and not exceeded_transfer_limit:
                break

            current_offset += request_page_size

        return {
            **(base_collection or {"type": "FeatureCollection"}),
            "features": features,
        }

    @staticmethod
    def _derive_arcgis_query_urls(
        *,
        service_url: str,
        payload: object,
        allowed_domains: set[str] | None,
    ) -> list[str]:
        if not _looks_like_arcgis_metadata_url(service_url):
            return []
        if not isinstance(payload, dict):
            return []

        parsed = urlparse(service_url)
        if allowed_domains and parsed.netloc.lower() not in allowed_domains:
            return []

        service_base_url = urlunparse(
            (parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "", "")
        )
        service_root_url = service_base_url
        parsed_layer_id = _extract_arcgis_layer_id(parsed.path)
        if parsed_layer_id is not None:
            service_root_url = re.sub(r"/\d+$", "", service_base_url)
        scored: list[tuple[int, str]] = []
        seen: set[str] = set()

        layer_id = parsed_layer_id
        if layer_id is not None and payload.get("geometryType") == "esriGeometryPolygon":
            query_url = _build_arcgis_query_url(
                service_base_url=service_root_url,
                layer_id=layer_id,
            )
            if query_url not in seen:
                seen.add(query_url)
                scored.append((50, query_url))

        layers = payload.get("layers")
        if isinstance(layers, list):
            for layer in layers:
                if not isinstance(layer, dict):
                    continue
                if layer.get("geometryType") != "esriGeometryPolygon":
                    continue
                if "feature" not in str(layer.get("type", "")).lower():
                    continue

                layer_id_value = layer.get("id")
                if not isinstance(layer_id_value, int):
                    continue

                name = str(layer.get("name", "")).lower()
                score = 0
                if "zoning" in name or "zone" in name:
                    score += 10
                if "in force" in name or "effect" in name:
                    score += 5
                if "proposed" in name:
                    score -= 5

                query_url = _build_arcgis_query_url(
                    service_base_url=service_root_url,
                    layer_id=layer_id_value,
                )
                if query_url in seen:
                    continue
                seen.add(query_url)
                scored.append((score, query_url))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [url for _score, url in scored]


def scrape_municipal_page(
    url: str,
    *,
    allowed_domains: set[str] | None = None,
    include_patterns: tuple[str, ...] = (),
    exclude_patterns: tuple[str, ...] = (),
) -> ScrapePageResult:
    with MunicipalWebScraper() as scraper:
        return scraper.scrape_links(
            url=url,
            allowed_domains=allowed_domains,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
        )


def scrape_geojson_data(
    source_url: str,
    *,
    geojson_url: str | None = None,
    allowed_domains: set[str] | None = None,
    paginate: bool = True,
    page_size: int | None = None,
    max_pages: int = 25,
) -> GeoJSONResult:
    with MunicipalWebScraper() as scraper:
        return scraper.scrape_geojson(
            source_url=source_url,
            geojson_url=geojson_url,
            allowed_domains=allowed_domains,
            paginate=paginate,
            page_size=page_size,
            max_pages=max_pages,
        )


def _normalize_url(*, base_url: str, href: str) -> str | None:
    joined = urljoin(base_url, href.strip())
    normalized, _fragment = urldefrag(joined)
    parsed = urlparse(normalized)

    if parsed.scheme not in {"http", "https"}:
        return None

    if not parsed.netloc:
        return None

    return normalized


def _matches_any(value: str, patterns: tuple[str, ...]) -> bool:
    value_lower = value.lower()
    return any(pattern in value_lower for pattern in patterns)


def _looks_like_geojson_url(url: str) -> bool:
    value = url.lower()
    return (
        value.endswith(".geojson")
        or value.endswith(".json")
        or "geojson" in value
        or "f=geojson" in value
    )


def _coerce_feature_collection(payload: object) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    if payload.get("type") != "FeatureCollection":
        return None
    features = payload.get("features")
    if not isinstance(features, list):
        return None
    return payload


def _looks_like_arcgis_query_url(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower()
    if "/query" not in path:
        return False
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    return params.get("f", "").lower() == "geojson"


def _replace_query_params(*, parsed, params: dict[str, str]) -> str:
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            urlencode(params, doseq=True),
            parsed.fragment,
        )
    )


def _coerce_positive_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    if parsed < 1:
        return None
    return parsed


def _coerce_non_negative_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    if parsed < 0:
        return None
    return parsed


def _try_parse_json(response: httpx.Response) -> object | None:
    try:
        return response.json()
    except ValueError:
        return None


def _looks_like_arcgis_metadata_url(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower()
    if "/query" in path:
        return False
    if "/mapserver" not in path and "/featureserver" not in path:
        return False
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    response_format = params.get("f", "").lower()
    return response_format in {"json", "pjson"}


def _extract_arcgis_layer_id(path: str) -> int | None:
    match = re.search(r"/(?:mapserver|featureserver)/(\d+)$", path.lower())
    if match is None:
        return None
    return int(match.group(1))


def _build_arcgis_query_url(*, service_base_url: str, layer_id: int) -> str:
    return (
        f"{service_base_url}/{layer_id}/query"
        "?where=1%3D1&outFields=*&f=geojson&outSR=4326"
    )
