"""调度配置的校验（需要 ORM，宿主机跳过）。

「权重可配置」的风险全在校验上：负权重、全零权重、拼错的策略名，
如果不拦住，问题会延迟到下一次调度才暴露。
"""

from __future__ import annotations

import pytest

pytest.importorskip("sqlalchemy")

from app.services.errors import BusinessError  # noqa: E402
from app.services.settings_store import (  # noqa: E402
    WEIGHT_FACTORS,
    env_defaults,
    load_dispatch_config,
    validate,
)


def test_defaults_come_from_env_and_include_六_factors():
    defaults = env_defaults()
    assert set(defaults["weights"]) == {code for code, _, _ in WEIGHT_FACTORS}
    assert 0 < defaults["sla_headroom"] <= 1
    assert 0 <= defaults["min_success_rate"] <= 1


def test_validate_normalises_partial_weights():
    """只传一个权重时，其余保持默认值，而不是变成 0。"""
    base = env_defaults()
    out = validate({"strategy": "s2_weighted", "weights": {"capability": 0.5}}, base=base)
    assert out["weights"]["capability"] == 0.5
    assert out["weights"]["success"] == base["weights"]["success"]


def test_validate_accepts_weights_not_summing_to_one():
    """只要总和非零就合法：界面允许用户按相对比例填。"""
    out = validate({"strategy": "s2_weighted", "weights": {"capability": 5, "success": 1}}, base=env_defaults())
    assert out["weights"]["capability"] == 5.0


def test_validate_rejects_negative_weight():
    with pytest.raises(BusinessError):
        validate({"strategy": "s2_weighted", "weights": {"cost": -0.1}}, base=env_defaults())


def test_validate_rejects_all_zero_weights():
    zero = {code: 0 for code, _, _ in WEIGHT_FACTORS}
    with pytest.raises(BusinessError) as exc:
        validate({"strategy": "s2_weighted", "weights": zero}, base=env_defaults())
    assert "大于 0" in str(exc.value)


def test_validate_rejects_unknown_strategy():
    with pytest.raises(BusinessError) as exc:
        validate({"strategy": "s9_magic"}, base=env_defaults())
    assert "未知策略" in str(exc.value)


def test_validate_rejects_unknown_weight_key():
    with pytest.raises(BusinessError):
        validate({"strategy": "s2_weighted", "weights": {"magic": 1}}, base=env_defaults())


def test_validate_rejects_sla_headroom_out_of_range():
    with pytest.raises(BusinessError):
        validate({"strategy": "s2_weighted", "sla_headroom": 1.5}, base=env_defaults())
    with pytest.raises(BusinessError):
        validate({"strategy": "s2_weighted", "sla_headroom": 0}, base=env_defaults())


def test_validate_rejects_min_success_rate_out_of_range():
    with pytest.raises(BusinessError):
        validate({"strategy": "s2_weighted", "min_success_rate": 1.2}, base=env_defaults())


def test_load_without_db_falls_back_to_env():
    config = load_dispatch_config(None)
    assert config["source"] == "env"
    assert config["strategy"] in {"s0_all_large", "s1_fixed_rule", "s2_weighted", "s3_cost_aware", "s4_llm_planner"}
