"""supply orders (real DataCo dataset)

Revision ID: 7b3c9e1a4d20
Revises: 965746c74770
Create Date: 2026-11-22 16:05:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '7b3c9e1a4d20'
down_revision = '965746c74770'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'supply_orders',
        sa.Column('order_id', sa.String(length=32), nullable=False),
        sa.Column('order_date', sa.DateTime(), nullable=True),
        sa.Column('shipping_date', sa.DateTime(), nullable=True),
        sa.Column('days_real', sa.Integer(), nullable=True),
        sa.Column('days_scheduled', sa.Integer(), nullable=True),
        sa.Column('delay_days', sa.Integer(), nullable=True),
        sa.Column('delivery_status', sa.String(length=32), nullable=False),
        sa.Column('late_risk', sa.Integer(), nullable=False),
        sa.Column('market', sa.String(length=32), nullable=False),
        sa.Column('order_region', sa.String(length=64), nullable=False),
        sa.Column('order_country', sa.String(length=64), nullable=False),
        sa.Column('order_city', sa.String(length=64), nullable=False),
        sa.Column('shipping_mode', sa.String(length=32), nullable=False),
        sa.Column('customer_segment', sa.String(length=32), nullable=False),
        sa.Column('department_name', sa.String(length=64), nullable=False),
        sa.Column('category_name', sa.String(length=64), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('sales', sa.Float(), nullable=False),
        sa.Column('profit', sa.Float(), nullable=False),
        sa.Column('item_count', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('order_id'),
    )
    op.create_index('ix_supply_orders_date', 'supply_orders', ['order_date'])
    op.create_index('ix_supply_orders_status', 'supply_orders', ['delivery_status'])
    op.create_index('ix_supply_orders_region', 'supply_orders', ['order_region'])


def downgrade() -> None:
    op.drop_index('ix_supply_orders_region', table_name='supply_orders')
    op.drop_index('ix_supply_orders_status', table_name='supply_orders')
    op.drop_index('ix_supply_orders_date', table_name='supply_orders')
    op.drop_table('supply_orders')
