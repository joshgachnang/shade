import {Box, Card, Heading, Page, Spinner, Text, TextField} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {FlatList, Image, Pressable} from "react-native";
import {type FrameAnalysis, useSearchQuery, useSearchSuggestQuery} from "@/store/sdk";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4020";

type FilterType = "all" | "objects" | "characters" | "text" | "tags";

const filterOptions: Array<{key: FilterType; label: string}> = [
  {key: "all", label: "All"},
  {key: "objects", label: "Objects"},
  {key: "characters", label: "Characters"},
  {key: "text", label: "Text"},
  {key: "tags", label: "Tags"},
];

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const SearchScreen: React.FC = () => {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const {data: suggestions} = useSearchSuggestQuery(query, {
    skip: query.length < 2,
  });

  const {data: searchResults, isLoading} = useSearchQuery(
    {q: submittedQuery, type: activeFilter},
    {skip: !submittedQuery}
  );

  const handleSubmit = useCallback(() => {
    setSubmittedQuery(query);
    setShowSuggestions(false);
  }, [query]);

  const handleSuggestionPress = useCallback((suggestion: string) => {
    setQuery(suggestion);
    setSubmittedQuery(suggestion);
    setShowSuggestions(false);
  }, []);

  const handleFilterChange = useCallback((filter: FilterType) => {
    setActiveFilter(filter);
  }, []);

  const handleResultPress = useCallback(
    (result: FrameAnalysis & {score: number}) => {
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
                  ? `${API_URL}/static/movies/${item.movieId}/frames/frame_${String((item.frame.frameNumber || 0) + 1).padStart(6, "0")}.jpg`
                  : undefined,
              }}
              style={{width: 120, height: 68, borderRadius: 4}}
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
            value={query}
            onChange={setQuery}
            onFocus={() => setShowSuggestions(true)}
            onSubmitEditing={handleSubmit}
          />

          {/* Suggestions */}
          {showSuggestions && suggestions?.suggestions && suggestions.suggestions.length > 0 && (
            <Box testID="search-suggestions-list" color="base" borderRadius={4} marginTop={1}>
              {suggestions.suggestions.map((s, i) => (
                <Pressable key={s} onPress={() => handleSuggestionPress(s)}>
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
          {filterOptions.map(({key, label}) => (
            <Pressable
              key={key}
              testID={`search-filter-${key}`}
              onPress={() => handleFilterChange(key)}
            >
              <Box
                paddingX={3}
                paddingY={1}
                borderRadius={16}
                color={activeFilter === key ? "primary" : "neutralLight"}
              >
                <Text size="sm" color={activeFilter === key ? "inverted" : "primary"}>
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
            <Text color="secondaryLight">No results found for "{submittedQuery}"</Text>
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
