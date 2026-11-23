"""skill_runs：技能执行事实表（试运行与工作流执行都记）

Revision ID: c7e3a91b5d24
Revises: b2d9f4c1a7e3
Create Date: 2026-11-23 12:05:00.000000

技能列表要显示"平均耗时 / 成功率 / 被引用次数"。
前两个数只能从真实执行里算——没有这张表，就只能在前端写个估算值糊弄过去。
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'c7e3a91b5d24'
down_revision = 'b2d9f4c1a7e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'skill_runs',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('skill_id', sa.String(length=32), nullable=True),
        sa.Column('skill_code', sa.String(length=64), nullable=False),
        sa.Column('ok', sa.Boolean(), nullable=False),
        sa.Column('duration_ms', sa.Float(), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column('input', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('error', sa.Text(), nullable=False),
        sa.Column('error_code', sa.String(length=24), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['skill_id'], ['skills.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_skill_runs_skill_code'), 'skill_runs', ['skill_code'], unique=False)
    op.create_index(
        op.f('ix_skill_runs_code_time'), 'skill_runs', ['skill_code', 'created_at'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_skill_runs_code_time'), table_name='skill_runs')
    op.drop_index(op.f('ix_skill_runs_skill_code'), table_name='skill_runs')
    op.drop_table('skill_runs')
