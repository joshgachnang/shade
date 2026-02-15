import {Box, Heading, Page, Text} from "@terreno/ui";
import type React from "react";

const HomeScreen: React.FC = () => {
  return (
    <Page navigation={undefined} title="Home">
      <Box padding={4} gap={4}>
        <Heading>Welcome to Shade</Heading>
        <Text>Your app is ready for development!</Text>
        <Text color="secondaryLight">
          Start by adding models to the backend and screens to the frontend.
        </Text>
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default HomeScreen;
