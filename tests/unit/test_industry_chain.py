"""产业链关联度计算的单元测试。

用一张 2 部门的手算例子验证公式，避免"跑通了但算错了"。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from industry_chain import compute_chain, mat_inverse  # noqa: E402


def test_inverse_of_identity_is_identity():
    assert mat_inverse([[1.0, 0.0], [0.0, 1.0]]) == [[1.0, 0.0], [0.0, 1.0]]


def test_inverse_of_known_matrix():
    # [[2,1],[1,3]] 的逆 = 1/5 * [[3,-1],[-1,2]]
    result = mat_inverse([[2.0, 1.0], [1.0, 3.0]])
    assert result[0][0] == pytest.approx(0.6)
    assert result[0][1] == pytest.approx(-0.2)
    assert result[1][0] == pytest.approx(-0.2)
    assert result[1][1] == pytest.approx(0.4)


def test_singular_matrix_raises():
    with pytest.raises(ValueError, match="奇异"):
        mat_inverse([[1.0, 1.0], [1.0, 1.0]])


def test_two_sector_hand_calculation():
    """手算：A = [[0.2, 0.1], [0.1, 0.3]]，L = (I-A)^-1。

    I-A = [[0.8,-0.1],[-0.1,0.7]]，行列式 = 0.55
    L = 1/0.55 * [[0.7, 0.1],[0.1, 0.8]]
      = [[1.2727, 0.1818],[0.1818, 1.4545]]
    列和 = [1.4545, 1.6364]，行和 = [1.4545, 1.6364]（对称矩阵，行列和相同）
    平均 = 1.54545
    影响力 = [0.9412, 1.0588]
    """
    # 部门 0 总产出 100，部门 1 总产出 200
    flows = [[20.0, 20.0], [10.0, 60.0]]
    outputs = [100.0, 200.0]
    result = compute_chain(flows, outputs, ["A", "B"])

    assert result.direct_consumption[0][0] == pytest.approx(0.2)
    assert result.direct_consumption[0][1] == pytest.approx(0.1)
    assert result.direct_consumption[1][0] == pytest.approx(0.1)
    assert result.direct_consumption[1][1] == pytest.approx(0.3)

    assert result.influence[0] == pytest.approx(0.9412, abs=1e-4)
    assert result.influence[1] == pytest.approx(1.0588, abs=1e-4)
    assert result.sensitivity[0] == pytest.approx(0.9412, abs=1e-4)
    assert result.sensitivity[1] == pytest.approx(1.0588, abs=1e-4)


def test_influence_and_sensitivity_differ_for_asymmetric_matrix():
    """非对称投入结构下，前向与后向关联不应相同。"""
    flows = [[50.0, 5.0], [150.0, 40.0]]
    outputs = [200.0, 200.0]
    result = compute_chain(flows, outputs, ["上游", "下游"])
    # 下游对上游的直接消耗很高，上游客易被拉动（感应度），但自身对下游依赖低
    assert result.sensitivity[0] != pytest.approx(result.influence[0], abs=1e-6)


def test_dimension_mismatch_raises():
    with pytest.raises(ValueError, match="维度"):
        compute_chain([[1.0, 2.0]], [100.0, 200.0], ["A", "B"])


def test_non_positive_output_raises():
    with pytest.raises(ValueError, match="总产出"):
        compute_chain([[1.0, 2.0], [3.0, 4.0]], [100.0, 0.0], ["A", "B"])


def test_average_coefficient_is_one():
    """系数是相对平均值的比，全部部门系数之和应等于部门数。"""
    flows = [[30.0, 10.0], [20.0, 60.0]]
    outputs = [100.0, 200.0]
    result = compute_chain(flows, outputs, ["A", "B"])
    assert sum(result.influence) == pytest.approx(2.0, abs=1e-9)
    assert sum(result.sensitivity) == pytest.approx(2.0, abs=1e-9)
