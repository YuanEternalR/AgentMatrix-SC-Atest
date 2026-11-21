"""Typed application settings.

Values come from environment variables (compose injects them via ``env_file``).
Local runs fall back to the compose-published host ports.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "development"
    log_level: str = "INFO"

    # --- infrastructure ----------------------------------------------------
    database_url: str = (
        "postgresql+psycopg://agentmatrix:agentmatrix_dev_pwd@localhost:5433/agentmatrix"
    )
    redis_url: str = "redis://localhost:6380/0"

    # --- auth --------------------------------------------------------------
    secret_key: str = "dev-only-change-me-0123456789abcdef0123456789abcdef"
    access_token_expire_minutes: int = 720

    # --- dispatch ----------------------------------------------------------
    dispatch_strategy: str = "s2_weighted"
    dispatch_sla_headroom: float = 0.8
    dispatch_min_success_rate: float = 0.85

    # --- llm gateway -------------------------------------------------------
    llm_provider: str = "mock"
    llm_api_base: str = ""
    llm_api_key: str = ""
    llm_model_large: str = ""
    llm_model_small: str = ""

    # --- demo --------------------------------------------------------------
    demo_fault_injection: bool = False

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
