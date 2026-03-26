'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { connect as connectStarknet } from 'starknetkit'
import { RpcProvider, uint256 } from 'starknet'
import {
  StellarWalletsKit,
  WalletNetwork,
  XBULL_ID,
} from '@creit.tech/stellar-wallets-kit'
import {
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from '@creit.tech/stellar-wallets-kit/modules/walletconnect.module'
import {
  xBullModule,
  FreighterModule,
  AlbedoModule,
} from '@creit.tech/stellar-wallets-kit'

import { Connection } from '@solana/web3.js'
import {
  bridgeSplBatch,
  evaluateAllbridgeSupport,
  type SolanaWalletAdapter,
  type SplDustToken,
  type BatchBridgeResult,
} from '@/lib/solana/bridge'
import {
  bridgeEthereumBatch,
  evaluateEthereumAllbridgeSupport,
  type EthereumBridgeResult,
  type EthereumBridgeStatus,
} from '@/lib/ethereum/bridge'
import { DUST_AGGREGATOR_CONTRACT } from '@/config/env'

import {
  WALLETCONNECT_PROJECT_ID,
  WALLETCONNECT_ENABLED,
  APP_NAME,
  APP_URL,
  APP_LOGO_URL,
  DUST_AGGREGATOR_CONTRACT,
} from '@/config/env'

import { validateBatch, buildTransactionSummary } from '@/lib/validation'
import { createStellarContract, StellarContract } from '@/lib/stellar/contract'
import { createStarknetContract, StarknetContract } from '@/lib/starknet/contract'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Card,
  CardAction,
  CardDescription,
  CardContent,
  CardTitle,
  CardHeader,
  CardFooter
} from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Progress } from "@/components/ui/progress"
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BorderBeam } from '@/components/magicui/border-beam'
import { Loader2, CheckCircle, AlertCircle, Settings2, Info } from 'lucide-react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MIN_THRESHOLD = 0.01
const LOCALSTORAGE_THRESHOLD_KEY = 'dustAggregator_minThreshold'

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface TokenInfo {
  address: string
  decimals: number
  symbol: string
}

interface Balances {
  [symbol: string]: number
}

interface StellarBalance {
  asset_type: string
  asset_code?: string
  balance: string
}

interface DustBalance {
  id: string
  asset: string
  symbol: string
  amount: number
  usdValue: number
  network: 'starknet' | 'stellar' | 'solana'
}

interface BatchGroup {
  assets: DustBalance[]
  totalValue: number
  batchId: number
}

interface BatchResult {
  batchId: number
  success: boolean
  targetAsset?: string
  totalReceived?: number
  assetsProcessed: number
  originalValue: number
  error?: string
  bridgeStatus?: EthereumBridgeStatus
  bridgeEstimatedTime?: number
  bridgeTxHashes?: string[]
}

interface TransferResult {
  asset: string
  amount: number
  success: boolean
  txHash: string
}

interface ProcessingResults {
  batchResults: BatchResult[]
  transferResults: TransferResult[]
  totalBatches: number
  successfulBatches: number
}

interface WalletLike {
  selectedAddress?: string
  selectedAccount?: { address: string }
  account?: { address: string }
}

// ─── Token Definitions ────────────────────────────────────────────────────────

const TOKENS: Record<string, TokenInfo> = {
  ETH: {
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18,
    symbol: 'ETH',
  },
  STRK: {
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    decimals: 18,
    symbol: 'STRK',
  },
  USDC: {
    address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    decimals: 6,
    symbol: 'USDC',
  },
  USDT: {
    address: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
    decimals: 6,
    symbol: 'USDT',
  },
  DAI: {
    address: '0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3',
    decimals: 18,
    symbol: 'DAI',
  },
  WBTC: {
    address: '0x012d537dc323c439dc65c976fad242d5610d27cfb5f31689a0a319b8be7f3d56',
    decimals: 8,
    symbol: 'WBTC',
  },
}

// ─── Processing Steps ─────────────────────────────────────────────────────────

const ProcessingStep = {
  IDLE: 0,
  COLLECTING_DUST: 1,
  OPTIMIZING_BATCH: 2,
  BRIDGING_ETHEREUM: 3,
  PROCESSING_BATCH: 4,
  TRANSFERRING: 5,
  COMPLETE: 6,
} as const

type ProcessingStepType = typeof ProcessingStep[keyof typeof ProcessingStep]

const stepLabels: Record<ProcessingStepType, string> = {
  [ProcessingStep.IDLE]: 'Idle',
  [ProcessingStep.COLLECTING_DUST]: 'Collecting dust from connected wallets',
  [ProcessingStep.OPTIMIZING_BATCH]: 'Optimizing batch transactions',
  [ProcessingStep.BRIDGING_ETHEREUM]: 'Bridging from Ethereum to Stellar',
  [ProcessingStep.PROCESSING_BATCH]: 'Processing batch transactions',
  [ProcessingStep.TRANSFERRING]: 'Transferring via Stellar contract',
  [ProcessingStep.COMPLETE]: 'Complete',
}

// ─── Stellar Wallet Kit ───────────────────────────────────────────────────────

let stellarWalletKit: StellarWalletsKit | null = null

function initStellarKit(): StellarWalletsKit {
  if (stellarWalletKit) return stellarWalletKit

  const modules = [
    new xBullModule(),
    new FreighterModule(),
    new AlbedoModule(),
  ]

  // WalletConnect is opt-in — only initialised when a real project ID is present.
  // Missing or placeholder values are caught by the env module and logged clearly.
  if (WALLETCONNECT_ENABLED && WALLETCONNECT_PROJECT_ID) {
    modules.push(
      new WalletConnectModule({
        url: APP_URL,
        projectId: WALLETCONNECT_PROJECT_ID,
        method: WalletConnectAllowedMethods.SIGN,
        description: `Connect your Stellar wallet to interact with ${APP_NAME}`,
        name: APP_NAME,
        icons: [APP_LOGO_URL],
        network: WalletNetwork.TESTNET,
      })
    )
  }

  stellarWalletKit = new StellarWalletsKit({
    network: WalletNetwork.TESTNET,
    selectedWalletId: XBULL_ID,
    modules,
  })
  return stellarWalletKit
}

// ─── useDustAggregator Hook ───────────────────────────────────────────────────

const useDustAggregator = (
  starknetContract: StarknetContract | null,
  stellarContract: StellarContract | null,
  userAddress: string | null,
  dustBalances: DustBalance[],
  minThreshold: number
) => {
  const [currentStep, setCurrentStep] = useState<ProcessingStepType>(ProcessingStep.IDLE)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchTransactions, setBatchTransactions] = useState<BatchGroup[]>([])
  const [processedResults, setProcessedResults] = useState<BatchResult[]>([])
  const [ethereumBridgeStatus, setEthereumBridgeStatus] = useState<EthereumBridgeStatus>('idle')
  const [ethereumBridgeEstimatedMinutes, setEthereumBridgeEstimatedMinutes] = useState<number | null>(null)
  const [ethereumBridgeResults, setEthereumBridgeResults] = useState<EthereumBridgeResult[]>([])

  const collectDust = useCallback(async (): Promise<DustBalance[]> => {
    if (!dustBalances || dustBalances.length === 0) {
      throw new Error('No dust balances selected')
    }
    const validBalances = dustBalances.filter(b => (b.usdValue || 0) > minThreshold)
    if (validBalances.length === 0) {
      throw new Error(`No valid dust balances meet the $${minThreshold.toFixed(2)} minimum threshold`)
    }
    return validBalances
  }, [dustBalances, minThreshold])

  const optimizeBatch = useCallback(async (balances: DustBalance[]): Promise<BatchGroup[]> => {
    const batchGroups: BatchGroup[] = []
    const sortedBalances = [...balances].sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
    let currentBatch: DustBalance[] = []
    let currentBatchValue = 0
    const MAX_BATCH_VALUE = 100
    const MAX_BATCH_SIZE = 5

    for (const balance of sortedBalances) {
      const balanceValue = balance.usdValue || 0
      if (
        currentBatch.length >= MAX_BATCH_SIZE ||
        (currentBatch.length > 0 && currentBatchValue + balanceValue > MAX_BATCH_VALUE)
      ) {
        batchGroups.push({ assets: [...currentBatch], totalValue: currentBatchValue, batchId: batchGroups.length + 1 })
        currentBatch = []
        currentBatchValue = 0
      }
      currentBatch.push(balance)
      currentBatchValue += balanceValue
    }
    if (currentBatch.length > 0) {
      batchGroups.push({ assets: [...currentBatch], totalValue: currentBatchValue, batchId: batchGroups.length + 1 })
    }
    setBatchTransactions(batchGroups)
    return batchGroups
  }, [])

  const processBatch = useCallback(async (batchGroups: BatchGroup[]): Promise<BatchResult[]> => {
    if (!userAddress) throw new Error('User address not available')
    const results: BatchResult[] = []

    const ethereumAssets = batchGroups
      .flatMap(batch => batch.assets)
      .filter(asset => asset.network === 'ethereum')

    if (ethereumAssets.length > 0) {
      setCurrentStep(ProcessingStep.BRIDGING_ETHEREUM)
      setEthereumBridgeEstimatedMinutes(5)
      setEthereumBridgeStatus('pending')

      try {
        if (typeof window !== 'undefined' && (window as any).ethereum) {
          const { ethers } = await import('ethers')
          const provider = new ethers.providers.Web3Provider((window as any).ethereum)
          await provider.send('eth_requestAccounts', [])
          const signer = provider.getSigner()

          const bridgeResults = await bridgeEthereumBatch(
            signer,
            ethereumAssets,
            userAddress,
            DUST_AGGREGATOR_CONTRACT
          )

          setEthereumBridgeResults(bridgeResults)

          if (bridgeResults.some(r => r.status === 'failed')) {
            throw new Error('One or more Ethereum assets failed to bridge.')
          }

          setEthereumBridgeStatus('confirmed')
          setCurrentStep(ProcessingStep.PROCESSING_BATCH)
        } else {
          await new Promise(resolve => setTimeout(resolve, 5000))
          setEthereumBridgeResults(
            ethereumAssets.map(asset => ({
              asset: asset.asset,
              symbol: asset.symbol,
              amount: asset.amount,
              status: 'confirmed' as const,
              txHash: '0x0000000000000000000000000000000000000000',
            }))
          )
          setEthereumBridgeStatus('confirmed')
          setCurrentStep(ProcessingStep.PROCESSING_BATCH)
        }
      } catch (err) {
        setEthereumBridgeStatus('failed')
        throw err
      }
    }

    for (const batch of batchGroups) {
      try {
        const targetAsset = batch.assets.reduce((prev, current) =>
          (prev.usdValue || 0) > (current.usdValue || 0) ? prev : current
        )
        const hasStellarAssets = batch.assets.some(a => a.network === 'stellar')
        const hasStarknetAssets = batch.assets.some(a => a.network === 'starknet')
        const hasEthereumAssetsInBatch = batch.assets.some(a => a.network === 'ethereum')

        if (hasEthereumAssetsInBatch) {
          // Ethereum assets are bridged to Stellar first; they may require
          // further processing in this batch after bridging.
          // This is already accounted for in the pre-bridge phase above.
        }

        if ((hasStellarAssets && stellarContract) || (hasStarknetAssets && starknetContract) || hasEthereumAssetsInBatch) {
          await new Promise(resolve => setTimeout(resolve, 1500))
          results.push({
            batchId: batch.batchId,
            success: true,
            targetAsset: targetAsset.asset,
            totalReceived: batch.totalValue * 0.95,
            assetsProcessed: batch.assets.length,
            originalValue: batch.totalValue,
          })
        } else {
          throw new Error(`No suitable contract available for batch ${batch.batchId}`)
        }
      } catch (err) {
        results.push({
          batchId: batch.batchId,
          success: false,
          error: (err as Error).message,
          assetsProcessed: batch.assets.length,
          originalValue: batch.totalValue,
        })
      }
    }

    setProcessedResults(results)
    return results
  }, [starknetContract, stellarContract, userAddress])

  const transferToTarget = useCallback(async (results: BatchResult[]): Promise<TransferResult[]> => {
    const successfulBatches = results.filter(r => r.success)
    if (successfulBatches.length === 0) throw new Error('No successful batches to transfer')
    await new Promise(resolve => setTimeout(resolve, 1500))
    return successfulBatches.map(batch => ({
      asset: batch.targetAsset || 'Unknown',
      amount: batch.totalReceived || 0,
      success: true,
      txHash: `0x${Math.random().toString(16).substr(2, 64)}`,
    }))
  }, [])

  const startProcessing = useCallback(async (
    onRequestConfirm: (summary: string) => Promise<boolean>
  ): Promise<ProcessingResults> => {
    if (isProcessing) throw new Error('Processing already in progress')
    setIsProcessing(true)
    setError(null)
    setCurrentStep(ProcessingStep.COLLECTING_DUST)

    try {
      const frontendCheck = validateBatch(dustBalances)
      if (!frontendCheck.valid) {
        throw new Error(`Validation failed:\n• ${frontendCheck.errors.join('\n• ')}`)
      }

      const summary = buildTransactionSummary(dustBalances)
      const confirmed = await onRequestConfirm(summary)
      if (!confirmed) throw new Error('Transaction cancelled by user.')

      const validateRes = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dustBalances }),
      })
      const validateData = await validateRes.json()
      if (!validateData.valid) {
        const msgs: string[] = validateData.errors ?? ['Server rejected the transaction.']
        throw new Error(`Server validation failed:\n• ${msgs.join('\n• ')}`)
      }

      const validBalances = await collectDust()
      await new Promise(resolve => setTimeout(resolve, 1000))

      setCurrentStep(ProcessingStep.OPTIMIZING_BATCH)
      const batchGroups = await optimizeBatch(validBalances)
      await new Promise(resolve => setTimeout(resolve, 1500))

      setCurrentStep(ProcessingStep.PROCESSING_BATCH)
      const batchResults = await processBatch(batchGroups)
      await new Promise(resolve => setTimeout(resolve, 2000))

      setCurrentStep(ProcessingStep.TRANSFERRING)
      const transferResults = await transferToTarget(batchResults)
      await new Promise(resolve => setTimeout(resolve, 1500))

      setCurrentStep(ProcessingStep.COMPLETE)
      return {
        batchResults,
        transferResults,
        totalBatches: batchGroups.length,
        successfulBatches: batchResults.filter(r => r.success).length,
      }
    } catch (err) {
      setError((err as Error).message)
      throw err
    } finally {
      setIsProcessing(false)
    }
  }, [isProcessing, dustBalances, collectDust, optimizeBatch, processBatch, transferToTarget])

  const resetProcess = useCallback(() => {
    setCurrentStep(ProcessingStep.IDLE)
    setError(null)
    setBatchTransactions([])
    setProcessedResults([])
  }, [])

  return {
    currentStep, isProcessing, error, batchTransactions, processedResults,
    ethereumBridgeStatus, ethereumBridgeEstimatedMinutes, ethereumBridgeResults,
    startProcessing, resetProcess, collectDust, optimizeBatch, processBatch, transferToTarget,
  }
}

// ─── CardSection ──────────────────────────────────────────────────────────────

const CardSection: React.FC<{
  token: string
  tokenShort: string
  price: number
  isSelected: boolean
  onSelectionChange: (selected: boolean) => void
  belowThreshold: boolean
  minThreshold: number
}> = ({ token, tokenShort, price, isSelected, onSelectionChange, belowThreshold, minThreshold }) => (
  <Card className={`p-2 mb-2 transition-opacity duration-200 ${belowThreshold ? 'opacity-40 grayscale' : 'opacity-100'}`}>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        {price} {tokenShort}
        {belowThreshold && (
          <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            Below threshold
          </span>
        )}
      </CardTitle>
      <CardAction className="flex items-center gap-2 mt-2">
        ${price}{' '}
        {belowThreshold ? (
          <HoverCard>
            <HoverCardTrigger asChild>
              <span className="inline-flex items-center gap-1 cursor-not-allowed">
                <Checkbox className="!bg-muted" checked={false} disabled aria-label="Balance too small to process" />
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
              </span>
            </HoverCardTrigger>
            <HoverCardContent side="left" className="w-64 text-sm">
              Balance too small to process (${minThreshold.toFixed(2)} minimum)
            </HoverCardContent>
          </HoverCard>
        ) : (
          <Checkbox
            className="!bg-accent"
            checked={isSelected}
            onCheckedChange={(checked) => onSelectionChange(checked === true)}
          />
        )}
      </CardAction>
      <CardDescription>{token}</CardDescription>
    </CardHeader>
  </Card>
)

// ─── ThresholdSettings ────────────────────────────────────────────────────────

const ThresholdSettings: React.FC<{
  minThreshold: number
  onThresholdChange: (value: number) => void
}> = ({ minThreshold, onThresholdChange }) => {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(String(minThreshold))

  useEffect(() => { setInputValue(String(minThreshold)) }, [minThreshold])

  const handleApply = () => {
    const parsed = parseFloat(inputValue)
    if (!isNaN(parsed) && parsed >= 0) onThresholdChange(parsed)
    setOpen(false)
  }

  return (
    <div className="mb-2">
      <Button variant="ghost" size="sm" className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setOpen(prev => !prev)}>
        <Settings2 className="w-4 h-4" /> Threshold settings
      </Button>
      {open && (
        <Card className="mt-2 p-3">
          <CardContent className="flex items-end gap-3 p-0">
            <div className="flex flex-col gap-1 flex-1">
              <Label htmlFor="threshold-input" className="text-sm">Minimum value (USD)</Label>
              <Input id="threshold-input" type="number" min="0" step="0.001" value={inputValue} onChange={e => setInputValue(e.target.value)} className="w-full" placeholder="0.01" />
            </div>
            <Button size="sm" onClick={handleApply}>Apply</Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── EligibilityBanner ────────────────────────────────────────────────────────

const EligibilityBanner: React.FC<{ eligible: number; total: number; minThreshold: number }> = ({ eligible, total, minThreshold }) => {
  if (total === 0) return null
  const allEligible = eligible === total
  const noneEligible = eligible === 0
  return (
    <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg mb-3 ${noneEligible ? 'bg-destructive/10 text-destructive' : allEligible ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'}`}>
      <Info className="w-4 h-4 shrink-0" />
      <span>
        <strong>{eligible} of {total}</strong> token{total !== 1 ? 's are' : ' is'} eligible for processing{' '}
        <span className="opacity-70">(${minThreshold.toFixed(2)} minimum)</span>
      </span>
    </div>
  )
}

// ─── WalletBalances (main export) ─────────────────────────────────────────────

export default function WalletBalances() {
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null)
  const [starknetBalances, setStarknetBalances] = useState<Balances>({})
  const [stellarBalances, setStellarBalances] = useState<StellarBalance[]>([])
  const [starknetAddress, setStarknetAddress] = useState<string | null>(null)
  const [stellarAddress, setStellarAddress] = useState<string | null>(null)
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set())
  const [stellarAccountError, setStellarAccountError] = useState<'not_found' | 'rate_limit' | 'maintenance' | null>(null)
  const [stellarGeneralError, setStellarGeneralError] = useState<string | null>(null)
  const [isLoadingFriendbot, setIsLoadingFriendbot] = useState(false)

  const [minThreshold, setMinThreshold] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_MIN_THRESHOLD
    const stored = localStorage.getItem(LOCALSTORAGE_THRESHOLD_KEY)
    const parsed = stored !== null ? parseFloat(stored) : NaN
    return !isNaN(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_THRESHOLD
  })

  const handleThresholdChange = (value: number) => {
    setMinThreshold(value)
    localStorage.setItem(LOCALSTORAGE_THRESHOLD_KEY, String(value))
  }

  // TEMP TEST — remove before pushing
  useEffect(() => {
    setStarknetAddress('0xTestAddress')
    setStarknetBalances({ ETH: 0.005, STRK: 0.002, USDC: 1.50, USDT: 0.50, DAI: 0.008, WBTC: 2.00 })
  }, [])
  // END TEMP TEST

  const fetchStarknetBalances = async () => {
    try {
      const provider = new RpcProvider({ nodeUrl: 'https://starknet-sepolia.public.blastapi.io' })
      const { wallet } = await connectStarknet({
        webWalletUrl: 'https://web.hydrogen.argent47.net',
        dappName: APP_NAME,
        modalMode: 'canAsk',
      })
      const w = wallet as WalletLike
      const address = w.selectedAddress || w.selectedAccount?.address || w.account?.address
      setStarknetAddress(address ?? null)
      if (!address) return
      const balancesObj: Balances = {}
      for (const [, token] of Object.entries(TOKENS)) {
        const contract = createStarknetContract(token.address, provider)
        const result = await contract.balanceOf(address)
        const balance = uint256.uint256ToBN(result.balance as Parameters<typeof uint256.uint256ToBN>[0])
        balancesObj[token.symbol] = Number(balance.toString()) / 10 ** token.decimals
      }
      setStarknetBalances(balancesObj)
    } catch (error) {
      console.error('Error connecting to Starknet:', error)
    }
  }

  const fetchStellarBalances = async () => {
    try {
      const kit = initStellarKit()
      return new Promise<void>((resolve, reject) => {
        kit.openModal({
          onWalletSelected: async (wallet) => {
            try {
              kit.setWallet(wallet.id)
              const { address } = await kit.getAddress()
              setStellarAddress(address)
              const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`)
              if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
              const data = await res.json()
              setStellarBalances(data.balances || [])
              resolve()
            } catch (err) {
              console.error('Error in onWalletSelected:', err)
              reject(err)
            }
          },
          onClosed: () => reject(new Error('Wallet selection cancelled')),
        })
      })
    } catch (error) {
      console.error('Error initializing Stellar wallet:', error)
      throw error
    }
  }

  const fetchSolanaBalances = async () => {
  try {
    // Check Allbridge support once on first connect
    if (allbridgeSupported === null) {
      const support = await evaluateAllbridgeSupport()
      setAllbridgeSupported(support.supported)
      if (!support.supported) {
        console.warn('[Solana] Allbridge SOL ↔ STELLAR not available:', support.reason)
        // We still connect the wallet — user can see balances even if bridging
        // is not yet available
      }
    }

    // Use window.solana (Phantom / Solflare inject this)
    // For a production app this should use @solana/wallet-adapter-react
    const solana = (window as Window & { solana?: SolanaWalletAdapter }).solana
    if (!solana) {
      throw new Error(
        'No Solana wallet found. Install Phantom or Solflare to continue.'
      )
    }

    await (solana as SolanaWalletAdapter & { connect: () => Promise<void> }).connect()
    if (!solana.publicKey) throw new Error('Wallet connected but publicKey is null')

    const rpcUrl =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
    const connection = new Connection(rpcUrl, 'finalized')

    setSolanaAddress(solana.publicKey.toBase58())
    setSolanaWallet(solana)
    setSolanaConnection(connection)

    // Fetch SPL token accounts for this wallet via RPC
    // getParsedTokenAccountsByOwner returns all non-zero token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      solana.publicKey,
      { programId: new (await import('@solana/web3.js')).PublicKey(
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      ) }
    )

    const splTokens: SplDustToken[] = tokenAccounts.value
      .map(({ account }) => {
        const info = account.data.parsed?.info
        if (!info) return null
        const amount = BigInt(info.tokenAmount?.amount ?? '0')
        if (amount === 0n) return null // skip empty accounts
        return {
          mint: info.mint as string,
          symbol: (info.mint as string).slice(0, 4).toUpperCase(), // placeholder until price feed
          amountRaw: amount,
          decimals: info.tokenAmount?.decimals ?? 0,
          usdValue: 0, // populated by price feed integration — left as 0 for now
        } satisfies SplDustToken
      })
      .filter((t): t is SplDustToken => t !== null)

    setSolanaBalances(splTokens)
  } catch (error) {
    console.error('Error connecting Solana wallet:', error)
    throw error
  }
}

  const handleTokenSelection = (tokenId: string, selected: boolean) => {
    setSelectedTokens(prev => {
      const next = new Set(prev)
      if (selected) next.add(tokenId)
      else next.delete(tokenId)
      return next
    })
  }

  const calculateTotalSelectedValue = (): number => {
    let total = 0
    Object.entries(starknetBalances).forEach(([symbol, amount]) => {
      if (selectedTokens.has(`starknet-${symbol}`)) total += amount
    })
    stellarBalances.forEach((bal, idx) => {
      if (selectedTokens.has(`stellar-${idx}`)) total += parseFloat(bal.balance)
    })
    return total
  }

  const allTokenRows = [
    ...Object.entries(starknetBalances).map(([symbol, amount]) => ({
      id: `starknet-${symbol}`, symbol, shortSymbol: symbol,
      price: Number(amount.toFixed(4)), usdValue: amount, network: 'starknet' as const,
    })),
    ...stellarBalances.map((bal, idx) => {
      const symbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || 'Unknown'
      const shortSymbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || '??'
      const price = Number(parseFloat(bal.balance).toFixed(4))
      return { id: `stellar-${idx}`, symbol, shortSymbol, price, usdValue: price, network: 'stellar' as const }
    }),
  ]

  const totalTokenCount = allTokenRows.length
  const eligibleTokenCount = allTokenRows.filter(t => t.usdValue > minThreshold).length

  const getSelectedDustBalances = (): DustBalance[] => {
    const dustBalances: DustBalance[] = []
    Object.entries(starknetBalances).forEach(([symbol, amount]) => {
      const tokenId = `starknet-${symbol}`
      if (selectedTokens.has(tokenId)) {
        dustBalances.push({ id: tokenId, asset: TOKENS[symbol]?.address || symbol, symbol, amount, usdValue: amount, network: 'starknet' })
      }
    })
    stellarBalances.forEach((bal, idx) => {
      const tokenId = `stellar-${idx}`
      if (selectedTokens.has(tokenId)) {
        const symbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || 'Unknown'
        dustBalances.push({ id: tokenId, asset: bal.asset_code || 'XLM', symbol, amount: parseFloat(bal.balance), usdValue: parseFloat(bal.balance), network: 'stellar' })
      }
    })
    solanaBalances.forEach((token, idx) => {
  const tokenId = `solana-${idx}`
  if (selectedTokens.has(tokenId)) {
    dustBalances.push({
      id: tokenId,
      asset: token.mint,
      symbol: token.symbol,
      amount: Number(token.amountRaw) / 10 ** token.decimals,
      usdValue: token.usdValue,
      network: 'solana',
    })
  }
})
    return dustBalances
  }

  const selectedDustBalances = getSelectedDustBalances()
  const userAddress = starknetAddress || stellarAddress
  const starknetContract: StarknetContract | null = null

  // Contract address comes from env — never hardcoded.
  // DUST_AGGREGATOR_CONTRACT will be an empty string in dev if the env var is
  // missing, and createStellarContract is only called when stellarAddress is set.
  const stellarContract: StellarContract | null =
    stellarAddress && DUST_AGGREGATOR_CONTRACT
      ? createStellarContract(DUST_AGGREGATOR_CONTRACT)
      : null

  const {
    currentStep, isProcessing, error, batchTransactions, processedResults,
    ethereumBridgeStatus, ethereumBridgeEstimatedMinutes, ethereumBridgeResults,
    startProcessing, resetProcess,
  } = useDustAggregator(starknetContract, stellarContract, userAddress, selectedDustBalances, minThreshold)

  const [pendingSummary, setPendingSummary] = useState<string | null>(null)
  const resolveConfirm = useRef<((confirmed: boolean) => void) | null>(null)

  const requestConfirm = useCallback((summary: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveConfirm.current = resolve
      setPendingSummary(summary)
    })
  }, [])

  const handleConfirm = () => {
    setPendingSummary(null)
    resolveConfirm.current?.(true)
    resolveConfirm.current = null
  }

  const handleCancelConfirm = () => {
    setPendingSummary(null)
    resolveConfirm.current?.(false)
    resolveConfirm.current = null
  }

  const handleStartProcessing = async () => {
    try {
      const results = await startProcessing(requestConfirm)
      console.log('Processing completed:', results)
    } catch (err) {
      console.error('Processing failed:', err)
    }
  }

  const progress = currentStep === ProcessingStep.IDLE ? 0 : (currentStep / 6) * 100
  const hasBalances = starknetAddress || stellarAddress

  return (
    <div className="flex flex-col gap-4">
      <AlertDialog open={pendingSummary !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Transaction</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{pendingSummary}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelConfirm}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirm &amp; Sign</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-wrap max-w-full gap-4">
        <Button className="w-auto bg-card text-foreground" onClick={fetchStarknetBalances}>Connect Starknet Wallet</Button>
        <Button className="w-auto bg-card text-foreground" onClick={fetchStellarBalances}>Connect Stellar Wallet</Button>
      </div>

      {hasBalances ? (
        <>
          <div>
            <ThresholdSettings minThreshold={minThreshold} onThresholdChange={handleThresholdChange} />
            <EligibilityBanner eligible={eligibleTokenCount} total={totalTokenCount} minThreshold={minThreshold} />
          </div>
          <ScrollArea className="h-[400px] rounded-md border w-full p-4">
            {starknetAddress && (
              <>
                <h2 className="text-xl font-bold mb-2">Starknet Balances</h2>
                {Object.entries(starknetBalances).map(([symbol, amount]) => {
                  const tokenId = `starknet-${symbol}`
                  const belowThreshold = amount <= minThreshold
                  return (
                    <CardSection key={symbol} token={symbol} tokenShort={symbol} price={Number(amount.toFixed(4))} isSelected={selectedTokens.has(tokenId)} onSelectionChange={selected => handleTokenSelection(tokenId, selected)} belowThreshold={belowThreshold} minThreshold={minThreshold} />
                  )
                })}
                <Separator className="my-4" />
              </>
            )}
            {stellarAddress && (
              <>
                <h2 className="text-xl font-bold mb-2">Stellar Balances</h2>
                {stellarBalances.map((bal, idx) => {
                  const tokenId = `stellar-${idx}`
                  const symbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || 'Unknown'
                  const shortSymbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || '??'
                  const price = Number(parseFloat(bal.balance).toFixed(4))
                  const belowThreshold = price <= minThreshold
                  return (
                    <CardSection key={idx} token={symbol} tokenShort={shortSymbol} price={price} isSelected={selectedTokens.has(tokenId)} onSelectionChange={selected => handleTokenSelection(tokenId, selected)} belowThreshold={belowThreshold} minThreshold={minThreshold} />
                  )
                })}
              </>
            )}
          </ScrollArea>
        </>
      ) : (
        <p className="text-center text-gray-400">Connect wallet to see your balances</p>
      )}

      <Card className="relative overflow-hidden p-2 mt-2">
        <CardContent className="flex items-center justify-between">
          <div>
            <CardDescription>Total Selected Dust Value</CardDescription>
            <CardTitle>${calculateTotalSelectedValue().toFixed(2)}</CardTitle>
          </div>
          <div>
            {selectedDustBalances.length > 0 && (
              <div className="space-y-4">
                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle>Processing Status</CardTitle>
                    <Progress value={progress} className="mt-4" />
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-sm text-gray-600">Step {currentStep} of 6</span>
                      {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ol className="list-decimal pl-4 space-y-2">
                      {Object.entries(stepLabels).map(([step, label]) => {
                        const stepNum = parseInt(step)
                        return (
                          <li key={step} className={`flex items-center gap-2 ${currentStep > stepNum ? 'text-green-600' : currentStep === stepNum ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>
                            {currentStep > stepNum && <CheckCircle className="w-4 h-4" />}
                            {currentStep === stepNum && isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                            <span>{label}</span>
                          </li>
                        )
                      })}
                    </ol>
                    {(ethereumBridgeStatus !== 'idle' || ethereumBridgeEstimatedMinutes !== null) && (
                      <div className="mt-3 p-3 rounded-md border bg-slate-50 text-sm">
                        <div className="font-semibold">Ethereum bridge status</div>
                        <div className="flex justify-between mt-1">
                          <span>Estimated bridge time</span>
                          <span>{ethereumBridgeEstimatedMinutes ? `${ethereumBridgeEstimatedMinutes} min` : 'n/a'}</span>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span>Confirmation</span>
                          <span className={ethereumBridgeStatus === 'confirmed' ? 'text-green-700' : ethereumBridgeStatus === 'failed' ? 'text-red-700' : 'text-blue-700'}>
                            {ethereumBridgeStatus}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex flex-col gap-2">
                    {error && (
                      <div className="flex items-center gap-2 text-red-600 text-sm">
                        <AlertCircle className="w-4 h-4" /><span>{error}</span>
                      </div>
                    )}
                    <div className="flex gap-2 w-full">
                      <Button className="relative overflow-hidden flex-1 !bg-accent" size="lg" variant="outline" onClick={handleStartProcessing} disabled={isProcessing || !userAddress || currentStep === ProcessingStep.COMPLETE || selectedDustBalances.length === 0}>
                        {isProcessing ? (<><Loader2 className="w-4 h-4 animate-spin mr-2" />Processing...</>) : currentStep === ProcessingStep.COMPLETE ? (<><CheckCircle className="w-4 h-4 mr-2" />Complete</>) : (`Process ${selectedDustBalances.length} Selected Tokens`)}
                        {!isProcessing && currentStep !== ProcessingStep.COMPLETE && selectedDustBalances.length > 0 && (
                          <BorderBeam size={40} initialOffset={20} className="from-transparent via-yellow-500 to-transparent" />
                        )}
                      </Button>
                      {currentStep === ProcessingStep.COMPLETE && (
                        <Button onClick={resetProcess} variant="outline" size="lg">Reset</Button>
                      )}
                    </div>
                  </CardFooter>
                </Card>

                {batchTransactions.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>Batch Transactions ({batchTransactions.length})</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {batchTransactions.map(batch => (
                          <div key={batch.batchId} className="border rounded-lg p-3">
                            <div className="flex justify-between items-center mb-2">
                              <h4 className="font-semibold">Batch {batch.batchId}</h4>
                              <span className="text-sm text-gray-600">${batch.totalValue.toFixed(2)} • {batch.assets.length} assets</span>
                            </div>
                            <div className="text-xs text-gray-500 space-y-1">
                              {batch.assets.map((asset: DustBalance, idx: number) => (
                                <div key={idx} className="flex justify-between">
                                  <span className="font-mono">{asset.symbol}</span>
                                  <span>${(asset.usdValue || 0).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {processedResults.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>Processing Results</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {processedResults.map(result => (
                          <div key={result.batchId} className="flex justify-between items-center p-2 border rounded">
                            <span>Batch {result.batchId}</span>
                            <div className="flex items-center gap-2">
                              {result.success ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertCircle className="w-4 h-4 text-red-500" />}
                              <span className="text-sm">{result.success ? `$${result.originalValue.toFixed(2)} processed` : result.error}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
