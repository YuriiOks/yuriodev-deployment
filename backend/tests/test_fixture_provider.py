"""FixtureProvider: reads the bundled synthetic drafts, never the network."""

import pytest

from src.feed.providers.base import ProviderError
from src.feed.providers.fixture import FixtureProvider

pytestmark = pytest.mark.anyio


async def test_lists_and_fetches_the_bundled_drafts():
    provider = FixtureProvider()

    summaries = await provider.list_published()
    raw = await provider.get_draft(summaries[0].draft_id)

    assert len(summaries) == 10
    assert raw["id"] == summaries[0].draft_id
    assert provider.polls is False
    assert provider.should_defer() is False


async def test_an_unknown_draft_is_not_found():
    with pytest.raises(ProviderError, match="not_found"):
        await FixtureProvider().get_draft(999_999)


async def test_a_fixture_row_without_an_update_time_fails_the_whole_listing(tmp_path):
    path = tmp_path / "drafts.json"
    path.write_text('{"drafts": [{"id": 1, "updated_at": "2026-09-20T08:30:00Z"}, {"id": 2}]}')

    with pytest.raises(ProviderError, match="bad_response"):
        await FixtureProvider(path).list_published()


@pytest.fixture(params=[None, "not json", '{"no_drafts": []}', '{"drafts": [1]}'])
def broken_fixture(request, tmp_path):
    path = tmp_path / "drafts.json"
    if request.param is not None:
        path.write_text(request.param)
    return path


async def test_a_broken_fixture_file_is_a_transient_error(broken_fixture):
    path = broken_fixture

    with pytest.raises(ProviderError, match="transient"):
        await FixtureProvider(path).list_published()
