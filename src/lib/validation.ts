// ─── validation.ts ────────────────────────────────────────────────────────────
// Pure validation functions used by both the frontend and the /api/validate
// server-side gate. Import from here — never duplicate this logic.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DustBalanceInput {
  id: string
  asset: string        // contract address (StarkNet/Ethereum) or asset code (Stellar)
  symbol: string
  amount: number
  usdValue: number
  network: 'starknet' | 'stellar' | 'ethereum'
  network: 'starknet' | 'stellar' | 'solana'
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ─── Token Allowlists ─────────────────────────────────────────────────────────
// Hardcoded testnet contract addresses.
// Add new verified contracts here before allowing them in any batch.

export const STARKNET_ALLOWLIST = new Set<string>([
  // StarkNet Sepolia testnet ERC-20 contracts
  '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7', // ETH
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', // STRK
  '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8', // USDC
  '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8', // USDT
  '0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3', // DAI
  '0x012d537dc323c439dc65c976fad242d5610d27cfb5f31689a0a319b8be7f3d56', // WBTC
])

export const STELLAR_ALLOWLIST = new Set<string>([
  // Stellar testnet Soroban contract addresses
  'CAENNM2HHYAKX4V3LSQM4BEPHZ6DUSPSGPQOW6QXDY5FOHB2HMB6TMNX', // Dust Aggregator
  // Native XLM is always allowed — represented by the 'XLM' symbol sentinel
  'XLM',
])

// ─── Address Format Validators ────────────────────────────────────────────────

/**
 * Validates a Stellar public key: starts with G, 56 chars, base32 alphabet.
 */
export function validateStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr)
}

/**
 * Validates a StarkNet address: 0x prefix followed by 1–64 hex characters.
 */
export function validateStarknetAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(addr)
}

// ─── Amount Validator ─────────────────────────────────────────────────────────

/**
 * Amount must be a positive finite number that doesn't exceed the held balance.
 * @param amount   The amount the user wants to process.
 * @param balance  The actual wallet balance for that token.
 */
export function validateAmount(amount: number, balance: number): ValidationResult {
  const errors: string[] = []

  if (!isFinite(amount) || isNaN(amount)) {
    errors.push('Amount is not a valid number.')
  } else if (amount <= 0) {
    errors.push('Amount must be greater than zero.')
  } else if (amount > balance) {
    errors.push(`Amount (${amount}) exceeds held balance (${balance}).`)
  }

  return { valid: errors.length === 0, errors }
}

// ─── Token Address Allowlist Validator ───────────────────────────────────────

/**
 * Checks a token contract address against the appropriate network allowlist.
 */
export function validateTokenAddress(
  address: string,
  network: 'starknet' | 'stellar' | 'ethereum'
): ValidationResult {
  if (network === 'ethereum') {
    // Allow any recognized address for now, infrastructure-specific allowlist
    // can be added later.
    return { valid: true, errors: [] }
  }

  network: 'starknet' | 'stellar' | 'solana'
): ValidationResult {
  if (network === 'solana') return { valid: true, errors: [] } // Skip for now
  const allowlist = network === 'starknet' ? STARKNET_ALLOWLIST : STELLAR_ALLOWLIST
  if (!allowlist.has(address)) {
    return {
      valid: false,
      errors: [`Token address "${address}" is not in the ${network} allowlist.`],
    }
  }
  return { valid: true, errors: [] }
}

// ─── Destination Address Validator ───────────────────────────────────────────

/**
 * Validates the destination wallet address for the given network.
 */
export function validateEthereumAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}

export function validateDestinationAddress(
  address: string,
  network: 'starknet' | 'stellar' | 'ethereum'
  network: 'starknet' | 'stellar' | 'solana'
): ValidationResult {
  if (network === 'solana') return { valid: true, errors: [] } // Skip for now
  const isValid =
    network === 'stellar'
      ? validateStellarAddress(address)
      : network === 'starknet'
        ? validateStarknetAddress(address)
        : validateEthereumAddress(address)

  if (!isValid) {
    const expected =
      network === 'stellar'
        ? 'Stellar address must be a G... public key (56 characters, base32)'
        : network === 'starknet'
          ? 'StarkNet address must be a 0x hex string'
          : 'Ethereum address must be a 0x-prefixed 40-hex-character string'
    return { valid: false, errors: [expected] }
  }

  return { valid: true, errors: [] }
}

// ─── Batch Validator ──────────────────────────────────────────────────────────

/**
 * Validates an entire batch of dust balances.
 * Checks: allowlisted address, positive non-zero amount, amount ≤ balance.
 *
 * @param dustBalances  The dust tokens selected for processing.
 * @param balances      Map of symbol → held balance for amount-ceiling checks.
 *                      If omitted, the `amount` on each DustBalanceInput is
 *                      checked against itself (always passes ceiling check).
 */
export function validateBatch(
  dustBalances: DustBalanceInput[],
  balances?: Record<string, number>
): ValidationResult {
  const errors: string[] = []

  if (!dustBalances || dustBalances.length === 0) {
    return { valid: false, errors: ['No tokens selected for processing.'] }
  }

  for (const dust of dustBalances) {
    const prefix = `[${dust.symbol} / ${dust.network}]`

    // 1. Allowlist check
    const addressCheck = validateTokenAddress(dust.asset, dust.network)
    if (!addressCheck.valid) {
      errors.push(...addressCheck.errors.map(e => `${prefix} ${e}`))
    }

    // 2. Amount check
    const heldBalance = balances ? (balances[dust.symbol] ?? dust.amount) : dust.amount
    const amountCheck = validateAmount(dust.amount, heldBalance)
    if (!amountCheck.valid) {
      errors.push(...amountCheck.errors.map(e => `${prefix} ${e}`))
    }

    // 3. USD value sanity
    if (dust.usdValue <= 0) {
      errors.push(`${prefix} USD value must be positive.`)
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Transaction Summary Builder ──────────────────────────────────────────────

/**
 * Returns a human-readable pre-signing summary string.
 * Example: "You are about to process 3 tokens worth ~$5.72"
 */
export function buildTransactionSummary(dustBalances: DustBalanceInput[]): string {
  const count = dustBalances.length
  const totalUsd = dustBalances.reduce((sum, d) => sum + (d.usdValue || 0), 0)
  return `You are about to process ${count} token${count !== 1 ? 's' : ''} worth ~$${totalUsd.toFixed(2)}`
}
