'use client'

import { Button } from './ui/button'
import { RefreshCcw } from 'lucide-react'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { BorderBeam } from '@/components/magicui/border-beam'
import StellarWalletButton from './StellarWallet'
import StarknetWalletButton from './StarknetWallet'
import { SolanaWalletButton } from './SolanaWallet'
import ScrollComponent from './ScrollIn'

export default function CollectDustComponent() {
  return (
    <div>
      {/* Stellar Wallet */}
      <Card className="relative overflow-hidden p-2 mb-2">
        <CardContent className=" flex items-center justify-between ">
          <div>
            <CardTitle>Stellar Wallet</CardTitle>
          </div>
          <div>
            <StellarWalletButton />
          </div>
        </CardContent>

        <BorderBeam duration={8} size={100} />
      </Card>

      {/* Starknet Wallet */}
      <Card className="relative overflow-hidden p-2 mb-2">
        <CardContent className=" flex items-center justify-between ">
          <div>
            <CardTitle>Starknet Wallet</CardTitle>
          </div>
          <div>
            <StarknetWalletButton />
          </div>
        </CardContent>

        <BorderBeam duration={8} size={100} />
      </Card>

      {/* Solana Wallet (New!) */}
      <Card className="relative overflow-hidden p-2 mb-2">
        <CardContent className=" flex items-center justify-between ">
          <div>
            <CardTitle>Solana Wallet</CardTitle>
          </div>
          <div>
            <SolanaWalletButton />
          </div>
        </CardContent>

        <BorderBeam duration={8} size={100} />
      </Card>

      {/* Ethereum Wallet */}
      <Card className="relative overflow-hidden p-2 mb-2">
        <CardContent className=" flex items-center justify-between ">
          <div>
            <CardTitle>
              Ethereum Wallet{' '}
              <span className=" text-destructive font-thin text-sm">
                Coming soon
              </span>
            </CardTitle>
          </div>
          <div>
            <Button
              className="relative overflow-hidden"
              size="lg"
              variant="outline"
            >
              Connect
              <BorderBeam
                size={40}
                initialOffset={20}
                className="from-transparent via-yellow-500 to-transparent"
                transition={{
                  type: 'spring',
                  stiffness: 60,
                  damping: 20,
                }}
              />
            </Button>
          </div>
        </CardContent>

        <BorderBeam duration={8} size={100} />
      </Card>

      <div className=" flex items-center justify-between mt-6 mb-4">
        <h1 className=" font-bold text-lg">Dust Balances</h1>
        <Button variant={'outline'}>
          <RefreshCcw />
          Refresh
        </Button>
      </div>

      <div className=" mb-6 gap-2">
        <ScrollComponent />
      </div>
    </div>
  )
}