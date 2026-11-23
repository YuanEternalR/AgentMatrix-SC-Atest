"""system_settings：运行时配置（目前只放调度策略）

Revision ID: d4f8b62c1a90
Revises: c7e3a91b5d24
Create Date: 2026-11-23 12:20:00.000000

把调度策略从"环境变量 + 重启"变成"数据库 + 即时生效"：
界面调完权重，下一次调度就用新参数，Worker 不用重启。
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'd4f8b62c1a90'
down_revision = 'c7e3a91b5d24'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('key', sa.String(length=64), nullable=False),
        sa.Column('value', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('updated_by', sa.String(length=32), nullable=True),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('key'),
    )


def downgrade() -> None:
    op.drop_table('system_settings')
