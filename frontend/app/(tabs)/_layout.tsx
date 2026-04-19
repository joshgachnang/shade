import FontAwesome from "@expo/vector-icons/FontAwesome";
import {Tabs} from "expo-router";
import type React from "react";
import {colors} from "@/constants/theme";

type IconName = React.ComponentProps<typeof FontAwesome>["name"];

const renderTabIcon =
  (name: IconName) =>
  ({color}: {color: string}): React.ReactElement => (
    <FontAwesome color={color} name={name} size={24} style={{marginBottom: -3}} />
  );

const homeIcon = renderTabIcon("home");
const searchIcon = renderTabIcon("search");
const profileIcon = renderTabIcon("user");

const TabLayout: React.FC = () => {
  return (
    <Tabs
      detachInactiveScreens={false}
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: homeIcon,
          title: "Home",
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          headerShown: false,
          tabBarIcon: searchIcon,
          title: "Search",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          headerShown: false,
          tabBarIcon: profileIcon,
          title: "Profile",
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          headerShown: false,
          href: null,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          headerShown: false,
          href: null,
        }}
      />
    </Tabs>
  );
};

// Expo Router requires default export for route files
export default TabLayout;
