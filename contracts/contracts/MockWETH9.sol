// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test double for WETH-9: just enough surface for SmokeSwapper.
contract MockWETH9 {
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, 'MockWETH9: balance');
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
}
