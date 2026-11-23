"""audit_logs table (append-only)

Revision ID: b2d9f4c1a7e3
Revises: 3f8a1c7d92b4
Create Date: 2026-11-23 11:40:00.000000

规格 5.8 要求「审批与审计均不可物理删除」。代码里不提供删除接口只是第一层，
这里用触发器把 DELETE/UPDATE 在数据库层挡住——否则任何人连上 psql 都能抹掉痕迹。
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'b2d9f4c1a7e3'
down_revision = '3f8a1c7d92b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('actor_id', sa.String(length=32), nullable=True),
        sa.Column('actor_name', sa.String(length=64), nullable=False),
        sa.Column('actor_role', sa.String(length=16), nullable=False),
        sa.Column('action', sa.String(length=48), nullable=False),
        sa.Column('resource_type', sa.String(length=32), nullable=False),
        sa.Column('resource_id', sa.String(length=64), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('before', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('after', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('ip', sa.String(length=64), nullable=False),
        sa.Column('user_agent', sa.String(length=255), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    op.create_index(
        op.f('ix_audit_logs_resource'), 'audit_logs', ['resource_type', 'resource_id'], unique=False
    )

    # 只追加：UPDATE / DELETE 一律拒绝（TRUNCATE 由权限控制，不在触发器范围）
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_logs 为只追加表，禁止 % 操作（合规要求）', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        "CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();"
    )
    op.execute(
        "CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only();")
    op.drop_index(op.f('ix_audit_logs_resource'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_created_at'), table_name='audit_logs')
    op.drop_table('audit_logs')
