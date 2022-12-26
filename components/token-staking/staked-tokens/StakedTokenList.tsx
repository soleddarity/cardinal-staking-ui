import { useWallet } from '@solana/wallet-adapter-react'
import { useHandleClaimRewards } from 'handlers/useHandleClaimRewards'
import type { StakeEntryTokenData } from 'hooks/useStakedTokenDatas'
import { useStakedTokenDatas } from 'hooks/useStakedTokenDatas'
import { useStakePoolMetadata } from 'hooks/useStakePoolMetadata'
import { useState } from 'react'
import type { UseMutationResult } from 'react-query'

import { DEFAULT_PAGE, PAGE_SIZE } from '@/components/token-staking/constants'
import { StakedToken } from '@/components/token-staking/staked-tokens/StakedToken'
import { TokenListWrapper } from '@/components/token-staking/TokenListWrapper'

export type StakedTokenListProps = {
  stakedSelected: StakeEntryTokenData[]
  setStakedSelected: (stakedSelected: StakeEntryTokenData[]) => void
  handleUnstake: UseMutationResult<
    string[],
    unknown,
    { tokenDatas: StakeEntryTokenData[] },
    unknown
  >
}

export const StakedTokenList = ({
  stakedSelected,
  setStakedSelected,
  handleUnstake,
}: StakedTokenListProps) => {
  const [pageNum, setPageNum] = useState<[number, number]>(DEFAULT_PAGE)
  const stakedTokenDatas = useStakedTokenDatas()
  const handleClaimRewards = useHandleClaimRewards()

  const wallet = useWallet()
  const { data: stakePoolMetadata } = useStakePoolMetadata()

  const isStakedTokenSelected = (tk: StakeEntryTokenData) =>
    stakedSelected.some(
      (stk) =>
        stk.stakeEntry?.parsed?.stakeMint.toString() ===
        tk.stakeEntry?.parsed?.stakeMint.toString()
    )

  const selectStakedToken = (tk: StakeEntryTokenData) => {
    if (handleUnstake.isLoading) return
    if (
      tk.stakeEntry?.parsed?.lastStaker.toString() !==
      wallet.publicKey?.toString()
    ) {
      return
    }
    if (isStakedTokenSelected(tk)) {
      setStakedSelected(
        stakedSelected.filter(
          (data) =>
            data.stakeEntry?.pubkey.toString() !==
            tk.stakeEntry?.pubkey.toString()
        )
      )
    } else {
      setStakedSelected([...stakedSelected, tk])
    }
  }
  return (
    <TokenListWrapper setPageNum={setPageNum}>
      {!stakedTokenDatas.isFetched ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
          <div className="aspect-square animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
          <div className="aspect-square animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
        </div>
      ) : stakedTokenDatas.data?.length === 0 ? (
        <p
          className={`font-normal ${
            stakePoolMetadata?.colors?.fontColor
              ? ''
              : 'text-gray-400 opacity-50'
          }`}
        >
          No tokens currently staked.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {!stakePoolMetadata?.notFound &&
            stakedTokenDatas.data &&
            stakedTokenDatas.data
              .slice(0, PAGE_SIZE * pageNum[0])
              .map((tk) => (
                <StakedToken
                  handleUnstake={handleUnstake}
                  key={tk?.stakeEntry?.pubkey.toBase58()}
                  tk={tk}
                  select={(tk) => selectStakedToken(tk)}
                  selected={isStakedTokenSelected(tk)}
                  loadingClaim={
                    handleClaimRewards.isLoading && isStakedTokenSelected(tk)
                  }
                  loadingUnstake={
                    handleUnstake.isLoading && isStakedTokenSelected(tk)
                  }
                />
              ))}
          {!stakePoolMetadata?.notFound &&
            stakedTokenDatas.data &&
            stakedTokenDatas.data
              .slice(0, PAGE_SIZE * pageNum[0])
              .map((tk) => (
                <StakedToken
                  handleUnstake={handleUnstake}
                  key={tk?.stakeEntry?.pubkey.toBase58()}
                  tk={tk}
                  select={(tk) => selectStakedToken(tk)}
                  selected={isStakedTokenSelected(tk)}
                  loadingClaim={
                    handleClaimRewards.isLoading && isStakedTokenSelected(tk)
                  }
                  loadingUnstake={
                    handleUnstake.isLoading && isStakedTokenSelected(tk)
                  }
                />
              ))}
        </div>
      )}
    </TokenListWrapper>
  )
}
