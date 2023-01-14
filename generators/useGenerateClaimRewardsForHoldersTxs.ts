import type { AccountData } from '@cardinal/common'
import { chunkArray } from '@cardinal/common'
import type { IdlAccountData } from '@cardinal/rewards-center'
import { claimRewards } from '@cardinal/rewards-center'
import { withClaimRewards } from '@cardinal/staking/dist/cjs/programs/rewardDistributor/transaction'
import type { StakeEntryData } from '@cardinal/staking/dist/cjs/programs/stakePool'
import { getActiveStakeEntriesForPool } from '@cardinal/staking/dist/cjs/programs/stakePool/accounts'
import { withUpdateTotalStakeSeconds } from '@cardinal/staking/dist/cjs/programs/stakePool/transaction'
import { useWallet } from '@solana/wallet-adapter-react'
import { Transaction } from '@solana/web3.js'
import { notify } from 'common/Notification'
import { asWallet } from 'common/Wallets'
import { useRewardDistributorData } from 'hooks/useRewardDistributorData'
import { useRewardMintInfo } from 'hooks/useRewardMintInfo'
import { getActiveStakePoolEntriesV2 } from 'hooks/useStakePoolEntries'
import { useMutation } from 'react-query'

import { isStakePoolV2, useStakePoolData } from '../hooks/useStakePoolData'
import { useEnvironmentCtx } from '../providers/EnvironmentProvider'

export const useGenerateClaimRewardsForHoldersTxs = () => {
  const wallet = asWallet(useWallet())
  const { connection } = useEnvironmentCtx()
  const stakePool = useStakePoolData()
  const rewardDistributor = useRewardDistributorData()
  const rewardMintInfo = useRewardMintInfo()

  const batchSize = 4
  const parallelTransactions = 20

  return useMutation(
    async (): Promise<Transaction[]> => {
      if (!wallet) throw 'Wallet not found'
      if (!stakePool.data || !stakePool.data.parsed || !stakePool.data.pubkey)
        throw 'No stake pool found'
      if (!rewardDistributor.data || !rewardDistributor.data.parsed)
        throw 'No reward distributor found'
      if (!rewardMintInfo.data) throw 'No reward mint info found'

      let stakeEntriesV1: AccountData<StakeEntryData>[] = []
      let stakeEntriesV2: Pick<
        IdlAccountData<'stakeEntry'>,
        'pubkey' | 'parsed'
      >[] = []
      if (isStakePoolV2(stakePool.data.parsed)) {
        stakeEntriesV2 = await getActiveStakePoolEntriesV2(
          connection,
          wallet,
          stakePool.data
        )
      } else {
        stakeEntriesV1 = await getActiveStakeEntriesForPool(
          connection,
          stakePool.data.pubkey
        )
      }
      console.log(
        `Estimated SOL needed to claim rewards for ${
          [...stakeEntriesV1, ...stakeEntriesV2].length
        } staked tokens:`,
        0.002 * [...stakeEntriesV1, ...stakeEntriesV2].length,
        'SOL'
      )

      let transactions: Transaction[] = []
      if (isStakePoolV2(stakePool.data.parsed)) {
        const chunkedEntries = chunkArray(stakeEntriesV2, batchSize)
        const batchedChunks = chunkArray(chunkedEntries, parallelTransactions)
        for (let i = 0; i < batchedChunks.length; i++) {
          const chunk = batchedChunks[i]!
          console.log(`> ${i + 1}/ ${batchedChunks.length}`)
          await Promise.all(
            chunk.map(async (entries) => {
              const txs = await claimRewards(
                connection,
                wallet,
                stakePool.data!.parsed.identifier,
                entries.map((entry) => {
                  return {
                    mintId: entry.parsed.stakeMint,
                  }
                })
              )
              transactions = [...transactions, ...txs]
            })
          )
        }
      } else {
        const chunkedEntries = chunkArray(stakeEntriesV1, batchSize)
        const batchedChunks = chunkArray(chunkedEntries, parallelTransactions)
        for (let i = 0; i < batchedChunks.length; i++) {
          const chunk = batchedChunks[i]!
          console.log(`> ${i + 1}/ ${batchedChunks.length}`)
          await Promise.all(
            chunk.map(async (entries, index) => {
              const transaction = new Transaction()
              for (let j = 0; j < entries.length; j++) {
                console.log(`>> ${j + 1}/ ${entries.length}`)
                const stakeEntryData = entries[j]!
                withUpdateTotalStakeSeconds(transaction, connection, wallet, {
                  stakeEntryId: stakeEntryData.pubkey,
                  lastStaker: wallet.publicKey,
                })
                await withClaimRewards(transaction, connection, wallet, {
                  stakePoolId: stakePool.data!.pubkey,
                  stakeEntryId: stakeEntryData.pubkey,
                  lastStaker: stakeEntryData.parsed.lastStaker,
                  payer: wallet.publicKey,
                })
              }
              transactions.push(transaction)
            })
          )
        }
      }

      return transactions
    },
    {
      onSuccess: (txs) => {
        if (txs.length === 0) {
          notify({
            message: 'No pending rewards to claim for holders',
          })
        } else {
          notify({
            message: `Successfully generated ${txs.length} transactions`,
          })
        }
      },
      onError: (e) => {
        notify({ message: 'Failed to stake', description: `${e}` })
      },
    }
  )
}
