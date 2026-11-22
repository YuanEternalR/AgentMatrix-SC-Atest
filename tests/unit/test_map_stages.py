"""阶段映射规则的单元测试。

锁住"哪个部门归哪个阶段"这个判断，避免改动规则后结论悄悄变了。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from map_stages import DEFAULT_STAGE, OTHER_STAGE, STAGE_NAME, STAGES, classify  # noqa: E402


def test_six_supply_chain_stages_declared():
    codes = [code for code, _ in STAGES]
    assert len(codes) == 6
    assert len(set(codes)) == 6
    # 科研流程已随业务替换下线
    assert "research" not in codes


def test_agriculture_is_procurement():
    assert classify("农产品") == "procurement"
    assert classify("煤炭开采和洗选产品") == "procurement"
    assert classify("钢") == "procurement"
    assert classify("电力、热力生产和供应") == "procurement"


def test_transport_beats_warehouse_only_where_explicit():
    # "装卸搬运和仓储" 必须先被仓储规则吃掉，不能被运输规则抢走
    assert classify("装卸搬运和仓储") == "warehousing"
    assert classify("道路货物运输和运输辅助活动") == "transportation"
    assert classify("邮政") == "transportation"


def test_demand_side():
    assert classify("批发") == "demand_planning"
    assert classify("零售") == "demand_planning"
    assert classify("餐饮") == "demand_planning"


def test_compliance_and_non_supply_chain_split():
    assert classify("货币金融和其他金融服务") == "compliance"
    assert classify("公共管理和社会组织") == "compliance"
    # 科研/教育/信息技术服务不属供应链，单独归类，不进矩阵
    assert classify("研究和试验发展") == OTHER_STAGE[0]
    assert classify("教育") == OTHER_STAGE[0]
    assert classify("信息技术服务") == OTHER_STAGE[0]


def test_manufacturing_falls_back_to_fulfillment():
    for sector in ("计算机", "汽车整车", "电子元器件", "建筑安装"):
        assert classify(sector) == DEFAULT_STAGE, sector
    assert STAGE_NAME[DEFAULT_STAGE] == "履约交付"


def test_every_rule_stage_is_declared():
    declared = {code for code, _ in STAGES} | {OTHER_STAGE[0]}
    assert DEFAULT_STAGE in declared
