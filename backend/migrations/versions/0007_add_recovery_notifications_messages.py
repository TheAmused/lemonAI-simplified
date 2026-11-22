"""password reset codes, notifications, moderation messages, e-mail preference, ratings, app releases

Revision ID: 0007_add_recovery_notifications
Revises: 0006_add_moderation
Create Date: 2026-11-16 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0007_add_recovery_notifications"
down_revision = "0006_add_moderation"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("notify_email", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("scripts", sa.Column("rating_sum", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("scripts", sa.Column("rating_count", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "ratings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("script_id", sa.String(length=36), sa.ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stars", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("script_id", "user_id", name="uq_ratings_script_user"),
    )
    op.create_index("ix_ratings_script_id", "ratings", ["script_id"])
    op.create_index("ix_ratings_user_id", "ratings", ["user_id"])

    op.create_table(
        "app_releases",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("version", sa.String(length=40), nullable=False),
        sa.Column("target", sa.String(length=40), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("signature", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("version", "target", name="uq_app_releases_version_target"),
    )
    op.create_index("ix_app_releases_target", "app_releases", ["target"])

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("script_id", sa.String(length=36), nullable=True),
        sa.Column("script_slug", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("read_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])

    op.create_table(
        "script_messages",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("script_id", sa.String(length=36), sa.ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("from_moderator", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_script_messages_script_id", "script_messages", ["script_id"])
    op.create_index("ix_script_messages_created_at", "script_messages", ["created_at"])


def downgrade():
    op.drop_index("ix_script_messages_created_at", table_name="script_messages")
    op.drop_index("ix_script_messages_script_id", table_name="script_messages")
    op.drop_table("script_messages")
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.drop_index("ix_app_releases_target", table_name="app_releases")
    op.drop_table("app_releases")
    op.drop_index("ix_ratings_user_id", table_name="ratings")
    op.drop_index("ix_ratings_script_id", table_name="ratings")
    op.drop_table("ratings")
    op.drop_column("scripts", "rating_count")
    op.drop_column("scripts", "rating_sum")
    op.drop_column("users", "notify_email")
