import { providers, Signer } from 'ethers'

// Allbridge chain identifiers. ETH and STELLAR are the ones needed for this task.
const ALLBRIDGE_ETHEREUM_CHAIN = 'ETH' as const
const ALLBRIDGE_STELLAR_CHAIN = 'STELLAR' as const

let _allbridgeCore: any | null = null

async function loadAllbridge() {
  const { AllbridgeCoreSdk, nodeUrlsDefault } = await import('@allbridge/bridge-core-sdk')
  const sdk = new AllbridgeCoreSdk(nodeUrlsDefault)
  return sdk
}

async function getAllbridge() {
  if (!_allbridgeCore) {
    _allbridgeCore = await loadAllbridge()
  }
  return _allbridgeCore
}

export type EthereumBridgeStatus = 'idle' | 'pending' | 'confirmed' | 'failed'

export interface EthereumBridgeResult {
  asset: string
  symbol: string
  amount: number
  status: EthereumBridgeStatus
  txHash?: string
  error?: string
}

export async function evaluateEthereumAllbridgeSupport(): Promise<{
  supported: boolean
  reason?: string
  ethereumTokens?: string[]
  stellarTokens?: string[]
}> {
  try {
    const sdk = await getAllbridge()
    const chains = await sdk.chainDetailsMap()

    const ethereumChain = chains[ALLBRIDGE_ETHEREUM_CHAIN]
    const stellarChain = chains[ALLBRIDGE_STELLAR_CHAIN]

    if (!ethereumChain) {
      return { supported: false, reason: 'Allbridge does not list an Ethereum chain on this environment.' }
    }
    if (!stellarChain) {
      return { supported: false, reason: 'Allbridge does not list a Stellar chain on this environment.' }
    }

    const ethereumTokens = ethereumChain.tokens.map((t: any) => t.symbol)
    const stellarTokens = stellarChain.tokens.map((t: any) => t.symbol)

    const bridgeable = ethereumTokens.filter((s: string) =>
      stellarTokens.some((t: string) => t.toUpperCase() === s.toUpperCase())
    )

    if (bridgeable.length === 0) {
      return {
        supported: false,
        reason: 'No tokens available on both Ethereum and Stellar sides.',
        ethereumTokens,
        stellarTokens,
      }
    }

    return { supported: true, ethereumTokens: bridgeable, stellarTokens: bridgeable }
  } catch (err) {
    return {
      supported: false,
      reason: `Failed to reach Allbridge API: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

interface DustAsset {
  asset: string
  symbol: string
  amount: number
  decimals?: number
  network: string
}

export async function bridgeEthereumBatch(
  signer: Signer,
  assets: DustAsset[],
  stellarDestinationAddress: string,
  stursalBlind?: string
): Promise<EthereumBridgeResult[]> {
  const results: EthereumBridgeResult[] = []

  if (!assets || assets.length === 0) {
    return results
  }

  const sdk = await getAllbridge()
  const chains = await sdk.chainDetailsMap()

  const ethereumChain = chains[ALLBRIDGE_ETHEREUM_CHAIN]
  const stellarChain = chains[ALLBRIDGE_STELLAR_CHAIN]

  if (!ethereumChain || !stellarChain) {
    throw new Error('Allbridge route ETH ↔ STELLAR is unavailable on this environment.')
  }

  const userAddress = await signer.getAddress()

  for (const asset of assets) {
    const result: EthereumBridgeResult = {
      asset: asset.asset,
      symbol: asset.symbol,
      amount: asset.amount,
      status: 'pending',
    }

    try {
      const sourceToken = ethereumChain.tokens.find((t: any) =>
        t.contractAddress?.toLowerCase() === asset.asset.toLowerCase() ||
        t.symbol?.toUpperCase() === asset.symbol.toUpperCase()
      )
      if (!sourceToken) {
        throw new Error(`${asset.symbol} not enabled in Allbridge Ethereum token pool.`)
      }

      const destinationToken = stellarChain.tokens.find((t: any) =>
        t.symbol?.toUpperCase() === asset.symbol.toUpperCase()
      )
      if (!destinationToken) {
        throw new Error(`${asset.symbol} not enabled in Allbridge Stellar token pool.`)
      }

      const transferAmount = asset.amount
      const rawTx: any = await sdk.bridge.rawTxBuilder.send({
        amount: String(transferAmount),
        fromAccountAddress: userAddress,
        toAccountAddress: stellarDestinationAddress,
        sourceToken,
        destinationToken,
        messenger: 1,
      })

      const txResponse = await signer.sendTransaction(rawTx)
      const txReceipt = await txResponse.wait(1)

      result.txHash = txReceipt.transactionHash || txReceipt.hash || txResponse.hash
      result.status = 'confirmed'
    } catch (err) {
      result.status = 'failed'
      result.error = err instanceof Error ? err.message : String(err)
    }

    results.push(result)
  }

  return results
}
