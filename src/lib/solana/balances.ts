import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const DUST_THRESHOLD = 0.05;

export interface DustToken {
  mint: string;
  amount: number;
  pubkey: string;
}

export async function fetchSplDustTokens(
  walletAddress: string, 
  connection: Connection
): Promise<DustToken[]> {
  try {
    const walletPublicKey = new PublicKey(walletAddress);

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPublicKey,
      { programId: TOKEN_PROGRAM_ID }
    );

    const dustTokens: DustToken[] = tokenAccounts.value
      .map((account) => {
        const parsedInfo = account.account.data.parsed.info;
        return {
          mint: parsedInfo.mint,
          amount: parsedInfo.tokenAmount.uiAmount || 0,
          pubkey: account.pubkey.toString(),
        };
      })
      .filter((token) => token.amount > 0 && token.amount < DUST_THRESHOLD);

    return dustTokens;
  } catch (error) {
    console.error('Error fetching Solana dust tokens:', error);
    return [];
  }
}