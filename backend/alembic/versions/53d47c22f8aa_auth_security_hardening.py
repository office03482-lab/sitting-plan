"""auth security hardening

Revision ID: 53d47c22f8aa
Revises: a6379ccf231f
Create Date: 2026-05-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "53d47c22f8aa"
down_revision = "a6379ccf231f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tokens", sa.Column("user_id", sa.Integer(), nullable=True))
    op.add_column("tokens", sa.Column("token_jti", sa.String(length=64), nullable=True))
    op.add_column("tokens", sa.Column("token_family", sa.String(length=64), nullable=True))
    op.add_column("tokens", sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("tokens", sa.Column("replaced_by_jti", sa.String(length=64), nullable=True))
    op.add_column("tokens", sa.Column("ip_address", sa.String(length=64), nullable=True))
    op.add_column("tokens", sa.Column("user_agent", sa.String(length=512), nullable=True))
    op.add_column("tokens", sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tokens", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_tokens_user_id"), "tokens", ["user_id"], unique=False)
    op.create_index(op.f("ix_tokens_token_jti"), "tokens", ["token_jti"], unique=False)
    op.create_index(op.f("ix_tokens_token_family"), "tokens", ["token_family"], unique=False)
    op.create_foreign_key(None, "tokens", "users", ["user_id"], ["id"])
    op.alter_column("tokens", "failure_count", server_default=None)

    op.create_table(
        "auth_throttles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scope_key", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_auth_throttles_id"), "auth_throttles", ["id"], unique=False)
    op.create_index(op.f("ix_auth_throttles_scope_key"), "auth_throttles", ["scope_key"], unique=True)
    op.create_index(op.f("ix_auth_throttles_action"), "auth_throttles", ["action"], unique=False)
    op.alter_column("auth_throttles", "failure_count", server_default=None)

    op.create_table(
        "auth_security_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("outcome", sa.String(length=50), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_auth_security_events_id"), "auth_security_events", ["id"], unique=False)
    op.create_index(op.f("ix_auth_security_events_user_id"), "auth_security_events", ["user_id"], unique=False)
    op.create_index(op.f("ix_auth_security_events_email"), "auth_security_events", ["email"], unique=False)
    op.create_index(op.f("ix_auth_security_events_event_type"), "auth_security_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_auth_security_events_outcome"), "auth_security_events", ["outcome"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_auth_security_events_outcome"), table_name="auth_security_events")
    op.drop_index(op.f("ix_auth_security_events_event_type"), table_name="auth_security_events")
    op.drop_index(op.f("ix_auth_security_events_email"), table_name="auth_security_events")
    op.drop_index(op.f("ix_auth_security_events_user_id"), table_name="auth_security_events")
    op.drop_index(op.f("ix_auth_security_events_id"), table_name="auth_security_events")
    op.drop_table("auth_security_events")

    op.drop_index(op.f("ix_auth_throttles_action"), table_name="auth_throttles")
    op.drop_index(op.f("ix_auth_throttles_scope_key"), table_name="auth_throttles")
    op.drop_index(op.f("ix_auth_throttles_id"), table_name="auth_throttles")
    op.drop_table("auth_throttles")

    op.drop_constraint(None, "tokens", type_="foreignkey")
    op.drop_index(op.f("ix_tokens_token_family"), table_name="tokens")
    op.drop_index(op.f("ix_tokens_token_jti"), table_name="tokens")
    op.drop_index(op.f("ix_tokens_user_id"), table_name="tokens")
    op.drop_column("tokens", "revoked_at")
    op.drop_column("tokens", "last_used_at")
    op.drop_column("tokens", "user_agent")
    op.drop_column("tokens", "ip_address")
    op.drop_column("tokens", "replaced_by_jti")
    op.drop_column("tokens", "failure_count")
    op.drop_column("tokens", "token_family")
    op.drop_column("tokens", "token_jti")
    op.drop_column("tokens", "user_id")
