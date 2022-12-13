import { withFindOrInitAssociatedTokenAccount } from '@cardinal/common'
import {
  findRewardEntryId as findRewardEntryIdV2,
  findStakeEntryId,
  rewardsCenterProgram,
} from '@cardinal/rewards-center'
import { executeTransaction, handleError } from '@cardinal/staking'
import { findRewardEntryId } from '@cardinal/staking/dist/cjs/programs/rewardDistributor/pda'
import {
  withInitRewardEntry,
  withUpdateRewardEntry,
} from '@cardinal/staking/dist/cjs/programs/rewardDistributor/transaction'
import { withInitStakeEntry } from '@cardinal/staking/dist/cjs/programs/stakePool/transaction'
import { findStakeEntryIdFromMint } from '@cardinal/staking/dist/cjs/programs/stakePool/utils'
import { BN } from '@project-serum/anchor'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { fetchRewardEntry } from 'api/fetchRewardEntry'
import { fetchStakeEntry } from 'api/fetchStakeEntry'
import { notify } from 'common/Notification'
import { asWallet } from 'common/Wallets'
import { useRewardDistributorData } from 'hooks/useRewardDistributorData'
import { useMutation } from 'react-query'

import { isStakePoolV2, useStakePoolData } from '../hooks/useStakePoolData'
import { useEnvironmentCtx } from '../providers/EnvironmentProvider'

export const useHandleSetMultipliers = () => {
  const walletContextWallet = useWallet()
  const wallet = asWallet(walletContextWallet)
  const { connection } = useEnvironmentCtx()
  const stakePool = useStakePoolData()
  const rewardDistributor = useRewardDistributorData()

  return useMutation(
    async ({
      multiplierMints,
      multipliers,
    }: {
      multiplierMints: (string | undefined)[] | undefined
      multipliers: (string | undefined)[] | undefined
    }): Promise<void> => {
      if (!wallet) throw 'Wallet not found'
      if (!stakePool.data || !stakePool.data.parsed) throw 'No stake pool found'
      if (!rewardDistributor.data) throw 'No reward distributor found'
      if (!multiplierMints) throw 'Invalid multiplier mints'
      if (!multipliers) throw 'Invalid multipliers'
      if (multipliers.length !== multiplierMints.length) {
        notify({
          message: `Error: Multiplier and mints aren't 1:1`,
          type: 'error',
        })
        return
      }

      const program = rewardsCenterProgram(connection, wallet)
      if (multiplierMints.toString() === [''].toString()) multiplierMints = []
      if (multipliers.toString() === [''].toString()) multipliers = []
      const pubKeysToSetMultiplier = []
      for (let i = 0; i < multiplierMints.length; i++) {
        if (multiplierMints[i] !== '' && multipliers[i] !== '') {
          pubKeysToSetMultiplier.push(new PublicKey(multiplierMints[i]!))
        } else {
          notify({
            message: `Error: Invalid multiplier mint "${multiplierMints[
              i
            ]!}" or multiplier "${multipliers[i]!}"`,
          })
          return
        }
      }

      if (pubKeysToSetMultiplier.length === 0) {
        notify({ message: `Info: No mints inserted` })
      }
      if (multipliers.length === 0) {
        notify({ message: `Info: No multiplier inserted` })
      }

      for (let i = 0; i < pubKeysToSetMultiplier.length; i++) {
        const transaction = new Transaction()

        const mintId = pubKeysToSetMultiplier[i]!
        const stakeEntryId = isStakePoolV2(stakePool.data.parsed)
          ? findStakeEntryId(stakePool.data.pubkey, mintId, wallet.publicKey)
          : (
              await findStakeEntryIdFromMint(
                connection,
                wallet.publicKey!,
                stakePool.data.pubkey,
                mintId
              )
            )[0]
        await withFindOrInitAssociatedTokenAccount(
          transaction,
          connection,
          mintId,
          stakeEntryId,
          wallet.publicKey,
          true
        )

        const stakeEntry = await fetchStakeEntry(
          connection,
          wallet,
          stakePool.data,
          mintId,
          false // TODO change for fungible
        )
        if (!stakeEntry) {
          if (isStakePoolV2(stakePool.data.parsed)) {
            const ix = await program.methods
              .initEntry(wallet.publicKey)
              .accounts({
                stakeEntry: stakeEntryId,
                stakePool: stakePool.data.pubkey,
                stakeMint: mintId,
                payer: wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .instruction()
            transaction.add(ix)
          } else {
            await withInitStakeEntry(transaction, connection, wallet, {
              stakePoolId: stakePool.data.pubkey,
              originalMintId: mintId,
            })
          }
          notify({
            message: `Initializing stake entry`,
            type: 'info',
          })
        }

        const rewardEntryId = isStakePoolV2(stakePool.data.parsed)
          ? findRewardEntryIdV2(rewardDistributor.data.pubkey, stakeEntryId)
          : (
              await findRewardEntryId(
                rewardDistributor.data.pubkey,
                stakeEntryId
              )
            )[0]
        const rewardEntry = fetchRewardEntry(
          connection,
          rewardDistributor.data,
          stakeEntryId
        )
        if (!rewardEntry) {
          if (isStakePoolV2(stakePool.data.parsed)) {
            const ix = await program.methods
              .initRewardEntry()
              .accounts({
                rewardEntry: rewardEntryId,
                stakeEntry: stakeEntryId,
                rewardDistributor: rewardDistributor.data.pubkey,
                payer: wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .instruction()
            transaction.add(ix)
          } else {
            await withInitRewardEntry(transaction, connection, wallet, {
              stakeEntryId,
              rewardDistributorId: rewardDistributor.data.pubkey,
            })
          }
          notify({
            message: `Initializing reward entry`,
            type: 'info',
          })
        }

        if (isStakePoolV2(stakePool.data.parsed)) {
          const ix = await program.methods
            .updateRewardEntry({ multiplier: new BN(multipliers[i]!) })
            .accounts({
              rewardEntry: rewardEntryId,
              rewardDistributor: rewardDistributor.data.pubkey,
              authority: wallet.publicKey,
            })
            .instruction()
          transaction.add(ix)
        } else {
          await withUpdateRewardEntry(transaction, connection, wallet, {
            stakePoolId: stakePool.data.pubkey,
            rewardDistributorId: rewardDistributor.data.pubkey,
            stakeEntryId: stakeEntryId,
            multiplier: new BN(multipliers[i]!),
          })
        }
        notify({
          message: `Updating multipler`,
          type: 'info',
        })
        await executeTransaction(connection, wallet, transaction, {
          silent: false,
          signers: [],
        })
        notify({
          message: `Successfully set multiplier ${i + 1}/${
            pubKeysToSetMultiplier.length
          }`,
          type: 'success',
        })
      }
    },
    {
      onError: (e) => {
        notify({
          message: 'Failed to set multiplier',
          description: handleError(e, `${e}`),
        })
      },
    }
  )
}
