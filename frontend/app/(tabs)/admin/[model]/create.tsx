import type {Api} from "@reduxjs/toolkit/query/react";
import {AdminModelForm} from "@terreno/admin-frontend";
import {Stack, useLocalSearchParams} from "expo-router";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

const AdminCreateScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  const modelTitle = model ? model.charAt(0).toUpperCase() + model.slice(1) : "Admin";

  return (
    <>
      <Stack.Screen options={{title: `Create ${modelTitle}`}} />
      <AdminModelForm
        api={terrenoApi as unknown as Api<any, any, any, any>}
        baseUrl="/admin"
        mode="create"
        modelName={model!}
      />
    </>
  );
};

// Expo Router requires default export for route files
export default AdminCreateScreen;
