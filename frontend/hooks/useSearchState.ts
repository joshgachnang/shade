import {useCallback, useState} from "react";

export type SearchFilterType = "all" | "objects" | "characters" | "text" | "tags";

export const searchFilterOptions: Array<{key: SearchFilterType; label: string}> = [
  {key: "all", label: "All"},
  {key: "objects", label: "Objects"},
  {key: "characters", label: "Characters"},
  {key: "text", label: "Text"},
  {key: "tags", label: "Tags"},
];

interface SearchState {
  /** Current value in the input box. Updates on every keystroke. */
  query: string;
  /** The value passed to the search endpoint; only updates when the user submits. */
  submittedQuery: string;
  /** Which filter chip is active. */
  activeFilter: SearchFilterType;
  /** Whether the autocomplete dropdown should be visible. */
  showSuggestions: boolean;
}

interface SearchStateActions {
  setQuery: (value: string) => void;
  setActiveFilter: (filter: SearchFilterType) => void;
  submit: () => void;
  applySuggestion: (suggestion: string) => void;
  openSuggestions: () => void;
  dismissSuggestions: () => void;
}

/**
 * Bundles the four pieces of search-screen state (current input, submitted
 * query, filter, suggestions visibility) and the transitions between them.
 * Extracted from the screen so the render body only wires props, and so the
 * transitions are easier to unit-test.
 */
export const useSearchState = (): SearchState & SearchStateActions => {
  const [query, setQueryValue] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeFilter, setActiveFilterValue] = useState<SearchFilterType>("all");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const setQuery = useCallback((value: string): void => {
    setQueryValue(value);
  }, []);

  const setActiveFilter = useCallback((filter: SearchFilterType): void => {
    setActiveFilterValue(filter);
  }, []);

  const submit = useCallback((): void => {
    setSubmittedQuery(query);
    setShowSuggestions(false);
  }, [query]);

  const applySuggestion = useCallback((suggestion: string): void => {
    setQueryValue(suggestion);
    setSubmittedQuery(suggestion);
    setShowSuggestions(false);
  }, []);

  const openSuggestions = useCallback((): void => {
    setShowSuggestions(true);
  }, []);

  const dismissSuggestions = useCallback((): void => {
    setShowSuggestions(false);
  }, []);

  return {
    query,
    submittedQuery,
    activeFilter,
    showSuggestions,
    setQuery,
    setActiveFilter,
    submit,
    applySuggestion,
    openSuggestions,
    dismissSuggestions,
  };
};
