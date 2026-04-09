import {AdminModelList} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/rtk";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

const AdminIndexScreen: React.FC = () => {
  return <AdminModelList api={terrenoApi} baseUrl={`${baseUrl}/admin`} />;
};

// Expo Router requires default export for route files
export default AdminIndexScreen;
