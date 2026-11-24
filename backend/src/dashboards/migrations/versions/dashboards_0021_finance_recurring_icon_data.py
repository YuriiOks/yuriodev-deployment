"""Finance: the icon of a recurring payment, fetched once by the server.

`recurring.icon_data` is the image (a PNG or SVG data URI that passed the logo checks) that the
server fetched from `icon_url`; `icon_checked_url` is the URL that fetch (or its refusal) was for,
so a changed URL is looked at again and a refused one is not asked for every minute. The browser
never loads the URL itself (the page's content security policy allows `self` and `data:` only).

`recurring.website` is the host of the payment's own site (a bare name, normalised): when there is
no `icon_url`, the server looks for the site's declared icon there.

Revision ID: dashboards_0021
Revises: dashboards_0020
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0021"
down_revision: str | Sequence[str] | None = "dashboards_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recurring", sa.Column("icon_data", sa.Text(), nullable=True), schema="finance")
    op.add_column(
        "recurring", sa.Column("icon_checked_url", sa.String(500), nullable=True), schema="finance"
    )
    op.add_column("recurring", sa.Column("website", sa.String(255), nullable=True), schema="finance")
