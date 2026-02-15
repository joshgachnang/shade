import {Box, Text} from "@terreno/ui";
import {Link, Stack} from "expo-router";
import type React from "react";

const NotFoundScreen: React.FC = () => {
  return (
    <>
      <Stack.Screen options={{title: "Oops!"}} />
      <Box flex={1} alignItems="center" justifyContent="center" padding={4}>
        <Text size="lg" weight="bold">
          This screen doesn't exist.
        </Text>
        <Link href="/" style={{marginTop: 16}}>
          <Text color="link">Go to home screen</Text>
        </Link>
      </Box>
    </>
  );
};

export default NotFoundScreen;
