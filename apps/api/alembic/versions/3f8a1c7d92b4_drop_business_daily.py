"""drop business_daily (replaced by real order aggregation)

Revision ID: 3f8a1c7d92b4
Revises: 7b3c9e1a4d20
Create Date: 2026-11-23 11:10:00.000000

`business_daily` 原本存的是用哈希编造的业务指标（OTIF / 周转 / 缺货率等）。
业务看板已改为直接聚合真实订单表 ``supply_orders``，这张表不再有任何读写，
留着只会让人误以为业务指标还是模拟数据，因此删除。
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '3f8a1c7d92b4'
down_revision = '7b3c9e1a4d20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index('ix_business_daily_day', table_name='business_daily')
    op.drop_table('business_daily')


def downgrade() -> None:
    # 恢复结构（数据无法恢复，原本就是模拟数据）
    op.create_table(
        'business_daily',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('day', sa.String(length=10), nullable=False),
        sa.Column('otif_rate', sa.Float(), nullable=False),
        sa.Column('inventory_turnover', sa.Float(), nullable=False),
        sa.Column('stockout_rate', sa.Float(), nullable=False),
        sa.Column('supplier_risk_high', sa.Integer(), nullable=False),
        sa.Column('supplier_risk_medium', sa.Integer(), nullable=False),
        sa.Column('supplier_risk_low', sa.Integer(), nullable=False),
        sa.Column('logistics_cost_usd', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_business_daily_day', 'business_daily', ['day'], unique=True)
