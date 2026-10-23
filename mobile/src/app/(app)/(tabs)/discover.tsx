import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SearchResults } from '@/features/discover/SearchResults';
import { useTranslation } from '@/i18n';
import { spacing } from '@/theme';
import { EmptyState, Screen, SearchBar, Text } from '@/ui';

/** Find someone. The results themselves are shared with the feeds' search bar. */
export default function DiscoverTab() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  return (
    <Screen padded={false} edges={['top']}>
      <View style={styles.search}>
        <Text variant="title">{t('discover.title')}</Text>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={t('discover.placeholder')}
          testID="discover-search"
        />
      </View>

      {query.trim() === '' ? (
        <View style={styles.centre}>
          <EmptyState
            icon="search-outline"
            title={t('discover.idleTitle')}
            body={t('discover.idleBody')}
          />
        </View>
      ) : (
        <SearchResults query={query} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  centre: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
});
