import {Box, Card, Heading, Page, Spinner, Text, TextField} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {FlatList, Image, Pressable} from "react-native";
import {searchFilterOptions, useSearchState} from "@/hooks/useSearchState";
import {type FrameAnalysis, useSearchQuery, useSearchSuggestQuery} from "@/store/sdk";
import {formatTimestamp, frameThumbnailStyle, getFrameImageUrl} from "@/utils";

const SearchScreen: React.FC = () => {
  const router = useRouter();
  const search = useSearchState();

  const {data: suggestions} = useSearchSuggestQuery(search.query, {
    skip: search.query.length < 2,
  });

  const {data: searchResults, isLoading} = useSearchQuery(
    {q: search.submittedQuery, type: search.activeFilter},
    {skip: !search.submittedQuery}
  );

  const handleResultPress = useCallback(
    (result: FrameAnalysis & {score: number}): void => {
      router.push(`/movies/${result.movieId}/frames/${result.frameId}` as any);
    },
    [router]
  );

  const renderResult = useCallback(
    ({item, index}: {item: FrameAnalysis & {score: number}; index: number}) => (
      <Pressable onPress={() => handleResultPress(item)} testID={`search-result-${index}`}>
        <Card>
          <Box padding={3} direction="row" gap={3}>
            <Image
              testID={`search-result-${index}-thumbnail`}
              source={{
                uri: item.frame
                  ? getFrameImageUrl({
                      movieId: item.movieId,
                      frameNumber: item.frame.frameNumber || 0,
                    })
                  : undefined,
              }}
              style={frameThumbnailStyle}
            />
            <Box flex="grow" gap={1} testID={`search-result-${index}-context`}>
              <Text size="sm" color="secondaryLight">
                {formatTimestamp(item.timestamp)}
              </Text>
              <Text size="sm" numberOfLines={2}>
                {item.sceneDescription}
              </Text>
              <Box direction="row" wrap gap={1}>
                {item.tags.slice(0, 3).map((tag) => (
                  <Text key={tag} size="sm" color="link">
                    #{tag}
                  </Text>
                ))}
              </Box>
            </Box>
          </Box>
        </Card>
      </Pressable>
    ),
    [handleResultPress]
  );

  return (
    <Page navigation={undefined} title="Search">
      <Box padding={4} gap={4} testID="search-screen">
        <Heading>Search</Heading>

        {/* Search input */}
        <Box>
          <TextField
            testID="search-input"
            placeholder="Search for objects, characters, text..."
            value={search.query}
            onChange={search.setQuery}
            onFocus={search.openSuggestions}
            onSubmitEditing={search.submit}
          />

          {/* Suggestions */}
          {search.showSuggestions &&
            suggestions?.suggestions &&
            suggestions.suggestions.length > 0 && (
              <Box testID="search-suggestions-list" color="base" rounding="sm" marginTop={1}>
                {suggestions.suggestions.map((s, i) => (
                  <Pressable key={s} onPress={() => search.applySuggestion(s)}>
                    <Box testID={`search-suggestion-${i}`} padding={2}>
                      <Text size="sm">{s}</Text>
                    </Box>
                  </Pressable>
                ))}
              </Box>
            )}
        </Box>

        {/* Filter tabs */}
        <Box direction="row" gap={2} wrap>
          {searchFilterOptions.map(({key, label}) => (
            <Pressable
              key={key}
              testID={`search-filter-${key}`}
              onPress={() => search.setActiveFilter(key)}
            >
              <Box
                paddingX={3}
                paddingY={1}
                rounding="full"
                color={search.activeFilter === key ? "primary" : "neutralLight"}
              >
                <Text size="sm" color={search.activeFilter === key ? "inverted" : "primary"}>
                  {label}
                </Text>
              </Box>
            </Pressable>
          ))}
        </Box>

        {/* Results */}
        {isLoading && (
          <Box testID="search-loading-spinner">
            <Spinner />
          </Box>
        )}

        {searchResults && searchResults.count === 0 && (
          <Box testID="search-empty-state" padding={8} alignItems="center">
            <Text color="secondaryLight">No results found for "{search.submittedQuery}"</Text>
          </Box>
        )}

        {searchResults && searchResults.count > 0 && (
          <FlatList
            testID="search-results-list"
            data={searchResults.results}
            renderItem={renderResult}
            keyExtractor={(item, index) => `${item._id}-${index}`}
            contentContainerStyle={{gap: 8}}
          />
        )}
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default SearchScreen;
