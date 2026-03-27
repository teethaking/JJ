"use client";

import { FC } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export const SolanaWalletButton: FC = () => {
  return (
    <div className="flex flex-col items-center justify-center p-4 border rounded-lg shadow-sm bg-white dark:bg-gray-800">
      <h3 className="mb-2 text-lg font-semibold text-purple-600">Solana Wallet</h3>
      <p className="mb-4 text-sm text-gray-500">Connect your Phantom or Solflare wallet</p>
      
      <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 transition-colors" />
    </div>
  );
};