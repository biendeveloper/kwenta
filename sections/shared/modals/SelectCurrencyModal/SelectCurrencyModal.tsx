import { NetworkId } from '@synthetixio/contracts-interface';
import { wei } from '@synthetixio/wei';
import orderBy from 'lodash/orderBy';
import { FC, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import InfiniteScroll from 'react-infinite-scroll-component';
import { getSynthsListForNetwork } from 'sdk/data/synths';
import { selectSynthBalancesLoading } from 'state/balances/selectors';
import { useAppSelector } from 'state/hooks';
import { FetchStatus } from 'state/types';
import styled, { css } from 'styled-components';

import Button from 'components/Button';
import SearchInput from 'components/Input/SearchInput';
import Loader from 'components/Loader';
import { CurrencyKey, CATEGORY_MAP, ETH_ADDRESS, ETH_COINGECKO_ADDRESS } from 'constants/currency';
import { DEFAULT_SEARCH_DEBOUNCE_MS } from 'constants/defaults';
import Connector from 'containers/Connector';
import useDebouncedMemo from 'hooks/useDebouncedMemo';
import useCoinGeckoTokenPricesQuery from 'queries/coingecko/useCoinGeckoTokenPricesQuery';
import { FlexDivCentered } from 'styles/common';
import media from 'styles/media';
import { toWei } from 'utils/formatters/number';

import { RowsHeader, CenteredModal } from '../common';
import CurrencyRow from './CurrencyRow';

const PAGE_LENGTH = 50;

export const CATEGORY_FILTERS = [CATEGORY_MAP.crypto, CATEGORY_MAP.forex, CATEGORY_MAP.commodity];

type SelectCurrencyModalProps = {
	synthsOverride?: Array<CurrencyKey>;
	onDismiss: () => void;
	onSelect: (currencyKey: string, isSynth: boolean) => void;
};

export const SelectCurrencyModal: FC<SelectCurrencyModalProps> = ({
	synthsOverride,
	onDismiss,
	onSelect,
}) => {
	const { t } = useTranslation();
	const { network } = Connector.useContainer();

	const [assetSearch, setAssetSearch] = useState('');
	const [synthCategory, setSynthCategory] = useState<string | null>(null);
	const [page, setPage] = useState(1);

	// Only available on Optimism mainnet
	const oneInchEnabled = network.id === 10;

	const allSynths = useMemo(() => getSynthsListForNetwork(network.id as NetworkId), [network.id]);

	const synths = !!synthsOverride
		? allSynths.filter((synth) => synthsOverride.includes(synth.name))
		: allSynths;

	const { balancesMap, tokenList, tokenBalances, balancesStatus } = useAppSelector(
		({ balances, exchange }) => ({
			balancesMap: balances.balancesMap,
			tokenList: exchange.tokenList,
			tokenBalances: balances.tokenBalances,
			balancesStatus: balances.status,
		})
	);

	const synthBalancesLoading = useAppSelector(selectSynthBalancesLoading);

	const categoryFilteredSynths = useMemo(
		() => (!!synthCategory ? synths.filter((synth) => synth.category === synthCategory) : synths),
		[synths, synthCategory]
	);

	const searchFilteredSynths = useDebouncedMemo(
		() =>
			assetSearch
				? categoryFilteredSynths.filter(({ name, description }) => {
						const assetSearchLC = assetSearch.toLowerCase();

						return (
							name.toLowerCase().includes(assetSearchLC) ||
							description.toLowerCase().includes(assetSearchLC)
						);
				  })
				: categoryFilteredSynths,
		[categoryFilteredSynths, assetSearch],
		DEFAULT_SEARCH_DEBOUNCE_MS
	);

	const synthsResults = useMemo(() => {
		const synthsList = assetSearch ? searchFilteredSynths : categoryFilteredSynths;
		return orderBy(
			synthsList,
			(synth) => {
				const synthBalance = balancesMap[synth.name as CurrencyKey];
				return !!synthBalance ? Number(synthBalance.usdBalance) : 0;
			},
			'desc'
		);
	}, [assetSearch, searchFilteredSynths, categoryFilteredSynths, balancesMap]);

	const synthKeys = useMemo(() => synthsResults.map((s) => s.name), [synthsResults]);

	const oneInchTokenList = useMemo(() => {
		return tokenList.filter((i) => !synthKeys.includes(i.symbol));
	}, [synthKeys, tokenList]);

	const searchFilteredTokens = useDebouncedMemo(
		() =>
			assetSearch
				? oneInchTokenList
						.filter(({ name, symbol }: any) => {
							const assetSearchLC = assetSearch.toLowerCase();
							return (
								name.toLowerCase().includes(assetSearchLC) ||
								symbol.toLowerCase().includes(assetSearchLC)
							);
						})
						.map((t: any) => ({ ...t, isSynth: false }))
				: oneInchTokenList,
		[oneInchTokenList, assetSearch],
		DEFAULT_SEARCH_DEBOUNCE_MS
	);

	const coinGeckoTokenPricesQuery = useCoinGeckoTokenPricesQuery(
		searchFilteredTokens.map((f) => f.address)
	);
	const coinGeckoPrices = coinGeckoTokenPricesQuery.data ?? null;

	const oneInchTokensPaged = useMemo(() => {
		if (!oneInchEnabled || (synthCategory && synthCategory !== 'crypto')) return [];
		const ordered =
			balancesStatus === FetchStatus.Success
				? orderBy(
						searchFilteredTokens.map((token) => {
							const tokenAddress =
								token.address === ETH_ADDRESS ? ETH_COINGECKO_ADDRESS : token.address;
							if (coinGeckoPrices?.[tokenAddress] && tokenBalances !== null) {
								const price = wei(coinGeckoPrices[tokenAddress].usd ?? 0);
								const balance = toWei(tokenBalances[token.symbol]?.balance);
								const usdBalance = price.mul(balance);

								return { ...token, usdBalance, balance };
							}
							return token;
						}),
						({ usdBalance }) => (usdBalance ? usdBalance.toNumber() : 0),
						'desc'
				  )
				: searchFilteredTokens;
		if (ordered.length > PAGE_LENGTH) return ordered.slice(0, PAGE_LENGTH * page);
		return ordered;
	}, [
		oneInchEnabled,
		synthCategory,
		searchFilteredTokens,
		page,
		coinGeckoPrices,
		tokenBalances,
		balancesStatus,
	]);

	return (
		<StyledCenteredModal onDismiss={onDismiss} isOpen title={t('modals.select-currency.title')}>
			<Container id="scrollableDiv">
				<SearchContainer>
					<AssetSearchInput
						placeholder={t('modals.select-currency.search.placeholder')}
						onChange={(e) => {
							setSynthCategory(null);
							setAssetSearch(e.target.value);
						}}
						value={assetSearch}
						autoFocus
					/>
				</SearchContainer>
				<CategoryFilters>
					{CATEGORY_FILTERS.map((category) => {
						const isActive = synthCategory === category;
						const noItem =
							synths.filter((synth) => synth.category.toString() === category).length === 0;

						return (
							<CategoryButton
								variant="secondary"
								isActive={isActive}
								disabled={noItem}
								onClick={() => {
									setAssetSearch('');
									setSynthCategory(isActive ? null : category);
								}}
								key={category}
							>
								{t(`common.currency-category.${category}`)}
							</CategoryButton>
						);
					})}
				</CategoryFilters>

				<InfiniteScroll
					dataLength={synthsResults.length + oneInchTokensPaged.length}
					next={() => {
						setTimeout(() => {
							setPage(page + 1);
						}, 200);
					}}
					hasMore={oneInchEnabled && oneInchTokensPaged.length !== oneInchTokenList.length}
					loader={
						<LoadingMore>
							<Loader inline />
						</LoadingMore>
					}
					scrollableTarget="scrollableDiv"
				>
					<RowsHeader>
						<span>
							{assetSearch ? (
								<span>{t('modals.select-currency.header.search-results')}</span>
							) : synthCategory != null ? (
								t('modals.select-currency.header.category-synths', {
									category: synthCategory,
								})
							) : (
								t('modals.select-currency.header.all-synths')
							)}
						</span>
						<span>{t('modals.select-currency.header.holdings')}</span>
					</RowsHeader>
					{synthBalancesLoading ? (
						<Loader />
					) : synthsResults.length > 0 ? (
						// TODO: use `Synth` type from contracts-interface
						synthsResults.map((synth) => {
							const currencyKey = synth.name;
							return (
								<CurrencyRow
									key={currencyKey}
									onClick={() => {
										onSelect(currencyKey, false);
										onDismiss();
									}}
									balance={balancesMap[currencyKey as CurrencyKey]}
									token={{
										name: synth.description,
										symbol: synth.name,
										isSynth: true,
									}}
								/>
							);
						})
					) : (
						<EmptyDisplay>{t('modals.select-currency.search.empty-results')}</EmptyDisplay>
					)}
					{oneInchTokensPaged.length ? (
						<>
							<TokensHeader>
								<span>
									{assetSearch ? (
										<span>{t('modals.select-currency.header.search-results')}</span>
									) : (
										t('modals.select-currency.header.other-tokens')
									)}
								</span>
								<span>{t('modals.select-currency.header.holdings')}</span>
							</TokensHeader>
							{oneInchTokensPaged.length > 0 ? (
								oneInchTokensPaged.map((token) => {
									const { symbol: currencyKey, balance, usdBalance } = token;
									return (
										<CurrencyRow
											key={currencyKey}
											onClick={() => {
												onSelect(currencyKey, true);
												onDismiss();
											}}
											balance={
												balance && usdBalance
													? {
															currencyKey,
															balance,
															usdBalance,
													  }
													: undefined
											}
											token={{ ...token, isSynth: false }}
										/>
									);
								})
							) : (
								<EmptyDisplay>{t('modals.select-currency.search.empty-results')}</EmptyDisplay>
							)}
						</>
					) : null}
				</InfiniteScroll>
			</Container>
		</StyledCenteredModal>
	);
};

const Container = styled.div`
	height: 100%;
	overflow-y: scroll;
`;

const StyledCenteredModal = styled(CenteredModal)`
	[data-reach-dialog-content] {
		width: 400px;
	}
	.card-body {
		height: 80vh;
		padding: 0px;
		overflow-y: scroll;
	}
`;

const SearchContainer = styled.div`
	margin: 0 16px 12px 16px;
`;

const AssetSearchInput = styled(SearchInput)`
	font-size: 16px;
	height: 40px;
	font-family: ${(props) => props.theme.fonts.regular};
	::placeholder {
		text-transform: capitalize;
		color: ${(props) => props.theme.colors.selectedTheme.button.secondary};
	}
`;

const CategoryFilters = styled.div`
	display: grid;
	grid-auto-flow: column;
	${media.lessThan('sm')`
		justify-content: space-between;
	`}
	justify-content: flex-start;
	column-gap: 10px;
	padding: 0 16px;
	margin-bottom: 18px;
`;

const CategoryButton = styled(Button)`
	height: 30px;
	text-transform: uppercase;
	font-size: 12px;

	${(props) =>
		props.isActive &&
		css`
			color: ${props.theme.colors.selectedTheme.button.text.primary};
			background: ${props.theme.colors.selectedTheme.button.fill};
		`};
	${(props) =>
		props.disabled &&
		css`
			color: ${props.theme.colors.selectedTheme.button.disabled.text};
			background: ${props.theme.colors.selectedTheme.button.disabled.background};
		`};
`;

const EmptyDisplay = styled(FlexDivCentered)`
	justify-content: center;
	font-size: 14px;
	font-family: ${(props) => props.theme.fonts.bold};
	text-align: center;
	margin: 24px 0px;
	height: 50px;
	color: ${(props) => props.theme.colors.selectedTheme.button.text.primary};
`;

const LoadingMore = styled.div`
	text-align: center;
`;

const TokensHeader = styled(RowsHeader)`
	margin-top: 10px;
`;

export default SelectCurrencyModal;
