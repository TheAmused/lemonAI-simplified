"""initial schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-10-31 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("email", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="user"),
        sa.Column("avatar_url", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "scripts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("author_id", sa.String(length=36), nullable=False),
        sa.Column("is_curated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="llm"),
        sa.Column("engine", sa.String(length=50), nullable=False, server_default="python_uv"),
        sa.Column("preview_image_url", sa.String(length=255), nullable=True),
        sa.Column("script_file_url", sa.String(length=255), nullable=True),
        sa.Column("min_vram_gb", sa.Float(), nullable=True, server_default="2.0"),
        sa.Column("min_ram_gb", sa.Float(), nullable=True, server_default="4.0"),
        sa.Column("manifest_data", sa.JSON(), nullable=False),
        sa.Column("downloads_count", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_scripts_slug"), "scripts", ["slug"], unique=True)
    op.create_index(op.f("ix_scripts_is_curated"), "scripts", ["is_curated"], unique=False)
    op.create_index(op.f("ix_scripts_category"), "scripts", ["category"], unique=False)

    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("jti"),
    )
    op.create_index(op.f("ix_revoked_tokens_user_id"), "revoked_tokens", ["user_id"], unique=False)
    op.create_index(op.f("ix_revoked_tokens_expires_at"), "revoked_tokens", ["expires_at"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_revoked_tokens_expires_at"), table_name="revoked_tokens")
    op.drop_index(op.f("ix_revoked_tokens_user_id"), table_name="revoked_tokens")
    op.drop_table("revoked_tokens")

    op.drop_index(op.f("ix_scripts_category"), table_name="scripts")
    op.drop_index(op.f("ix_scripts_is_curated"), table_name="scripts")
    op.drop_index(op.f("ix_scripts_slug"), table_name="scripts")
    op.drop_table("scripts")

    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_table("users")
