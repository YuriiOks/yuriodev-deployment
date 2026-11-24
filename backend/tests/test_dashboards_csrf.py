"""A page of another site must not make the owner's browser change anything: on the proxy-trust
path (dev, stage) the browser attaches the cached basic-auth credentials to a form posted from any
page, so the gate looks at what the browser says about who sent the request."""

import pytest

from src.dashboards.gate import ACCESS_HEADER
from tests.dashboards_support import CRED, UNREACHABLE_URL

WRITE = "/api/dashboards/v1/finance/attention/dismiss"
READ = "/api/dashboards/v1/finance/accounts"
BASE = "https://dev.example.test"


def post(client, headers=None):
    return client.post(WRITE, json={"key": "k"}, headers=headers or {})


def code(response):
    return response.json().get("error")


@pytest.mark.parametrize("site", ["cross-site", "same-site"])
def test_a_write_the_browser_says_another_site_sent_is_refused(make_client, site):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True)

    response = post(client, {"Sec-Fetch-Site": site})

    assert (response.status_code, code(response)) == (403, "cross_site")
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("site", ["same-origin", "none"])
def test_a_write_from_the_page_itself_or_typed_in_passes_the_gate(make_client, site):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True)

    response = post(client, {"Sec-Fetch-Site": site})

    assert (response.status_code, code(response)) == (503, "dashboards_unavailable")


def test_reading_is_never_refused_for_where_it_came_from(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True)

    foreign = {"Sec-Fetch-Site": "cross-site", "Origin": "https://x.test"}
    response = client.get(READ, headers=foreign)
    options = client.options(READ, headers={"Sec-Fetch-Site": "cross-site"})

    assert code(response) == "dashboards_unavailable"
    assert options.status_code != 403


def test_without_browser_headers_a_script_or_curl_is_not_checked(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True)

    assert code(post(client)) == "dashboards_unavailable"


def test_the_origin_must_be_the_public_base_when_it_is_set(make_client):
    client = make_client(
        database_url=UNREACHABLE_URL,
        dashboards_trust_proxy_auth=True,
        dashboards_public_base_url=BASE,
    )

    own = post(client, {"Origin": BASE})
    other = post(client, {"Origin": "https://evil.example.test"})
    sandboxed = post(client, {"Origin": "null"})
    plain_http = post(client, {"Origin": "http://dev.example.test"})

    assert code(own) == "dashboards_unavailable"
    assert [r.status_code for r in (other, sandboxed, plain_http)] == [403, 403, 403]


def test_without_a_public_base_the_origin_must_be_the_host_asked(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True)

    own = post(client, {"Host": "stage.example.test", "Origin": "https://stage.example.test"})
    other = post(client, {"Host": "stage.example.test", "Origin": "https://evil.example.test"})

    assert code(own) == "dashboards_unavailable"
    assert (other.status_code, code(other)) == (403, "cross_site")


def test_the_token_header_proves_it_was_not_a_form(make_client):
    client = make_client(
        database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True, dashboards_api_token=CRED
    )

    with_token = post(client, {ACCESS_HEADER: CRED, "Sec-Fetch-Site": "cross-site"})
    wrong_token = post(client, {ACCESS_HEADER: CRED + "x", "Sec-Fetch-Site": "cross-site"})

    assert code(with_token) == "dashboards_unavailable"
    assert wrong_token.status_code == 403


def test_token_mode_does_not_look_at_the_browser_headers(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_api_token=CRED)

    response = post(client, {ACCESS_HEADER: CRED, "Sec-Fetch-Site": "cross-site"})

    assert code(response) == "dashboards_unavailable"
    assert post(client, {"Sec-Fetch-Site": "cross-site"}).status_code == 401
