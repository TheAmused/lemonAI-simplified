"""moderation: entry status, reports, bans and the moderation log

Revision ID: 0006_add_moderation
Revises: 0005_add_installs_count
Create Date: 2026-11-16 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0006_add_moderation"
down_revision = "0005_add_installs_count"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("scripts", sa.Column("status", sa.String(length=20), nullable=False, server_default="published"))
    op.add_column("scripts", sa.Column("moderation_note", sa.Text(), nullable=True))
    op.add_column("scripts", sa.Column("moderated_at", sa.DateTime(), nullable=True))
    op.create_index("ix_scripts_status", "scripts", ["status"])

    op.add_column("users", sa.Column("banned_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("ban_reason", sa.Text(), nullable=True))

    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("script_id", sa.String(length=36), sa.ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reporter_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.String(length=20), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
    )
    op.create_index("ix_reports_script_id", "reports", ["script_id"])
    op.create_index("ix_reports_reporter_id", "reports", ["reporter_id"])
    op.create_index("ix_reports_status", "reports", ["status"])

    op.create_table(
        "moderation_actions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("actor_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.String(length=36), nullable=False),
        sa.Column("target_label", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_moderation_actions_actor_id", "moderation_actions", ["actor_id"])
    op.create_index("ix_moderation_actions_target_id", "moderation_actions", ["target_id"])
    op.create_index("ix_moderation_actions_created_at", "moderation_actions", ["created_at"])


def downgrade():
    op.drop_index("ix_moderation_actions_created_at", table_name="moderation_actions")
    op.drop_index("ix_moderation_actions_target_id", table_name="moderation_actions")
    op.drop_index("ix_moderation_actions_actor_id", table_name="moderation_actions")
    op.drop_table("moderation_actions")
    op.drop_index("ix_reports_status", table_name="reports")
    op.drop_index("ix_reports_reporter_id", table_name="reports")
    op.drop_index("ix_reports_script_id", table_name="reports")
    op.drop_table("reports")
    op.drop_column("users", "ban_reason")
    op.drop_column("users", "banned_at")
    op.drop_index("ix_scripts_status", table_name="scripts")
    op.drop_column("scripts", "moderated_at")
    op.drop_column("scripts", "moderation_note")
    op.drop_column("scripts", "status")
