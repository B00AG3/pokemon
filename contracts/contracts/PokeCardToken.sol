// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';

/// @title PokeCardToken
/// @notice Fixed-supply ERC-20 for the PokeCard Lab ecosystem on Robinhood
/// Chain. The full supply mints to the deployer (treasury), which seeds the
/// liquidity pool and funds milestone card purchases.
contract PokeCardToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor(address initialHolder) ERC20('PokeCard', 'POKE') Ownable(msg.sender) {
        require(initialHolder != address(0), 'zero holder');
        _mint(initialHolder, MAX_SUPPLY);
    }
}
