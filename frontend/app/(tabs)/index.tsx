import {Box, Button, Heading, Page, Text} from "@terreno/ui";
import {type Href, useRouter} from "expo-router";
import type React from "react";

const HomeScreen: React.FC = () => {
  const router = useRouter();
  return (
    <Page navigation={undefined} title="Home">
      <Box padding={4} gap={4} testID="home-screen">
        <Heading>Welcome to Shade</Heading>
        <Text>Your app is ready for development!</Text>
        <Text color="secondaryLight">
          Start by adding models to the backend and screens to the frontend.
        </Text>
        <Box marginTop={2}>
          <Button
            testID="home-open-console-button"
            text="Open Shade Console"
            onClick={() => router.push("/console" as Href)}
          />
        </Box>
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default HomeScreen;
