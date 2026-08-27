import React from 'react';
import { AddProfileForm } from './AddProfileForm';
import { EditProfileForm } from './EditProfileForm';
import { ImportDialog } from './ImportDialog';
import { CaCertificateInstallModal } from './CaCertificateInstallModal';
import { CaCertificateUninstallModal } from './CaCertificateUninstallModal';
import { StorageManagementModal } from './StorageManagementModal';
import { PricesModal } from './PricesModal';
import { isProfileRunning } from '../utils/runningInstances';
import type {
  ImportOptions,
  InstanceInfoMap,
  ModelPricingDisplayData,
  Profile,
  ProxyInstallGuide,
  StorageBreakdown,
  StorageCleanupAction,
  StorageCleanupResult,
} from '../types';

interface AppDialogsProps {
  showImportDialog: boolean;
  onImport: (json: string, options: ImportOptions) => void;
  onCloseImport: () => void;
  showAddForm: boolean;
  onAddProfile: (
    email: string,
    displayName?: string,
    theme?: string,
    color?: string,
    emoji?: string
  ) => void;
  onCloseAddForm: () => void;
  suggestedEmail?: string;
  suggestedDisplayName?: string;
  suggestedNotice?: string;
  editingProfile?: Profile;
  currentProfileId?: string;
  onEditSubmit: (profileId: string, updates: Partial<Profile>) => void;
  onCloseEditForm: () => void;
  showUninstallConfirm: boolean;
  uninstallInProgress: boolean;
  onConfirmUninstall: () => void;
  onCloseUninstallConfirm: () => void;
  showCertInstallModal: boolean;
  installGuide: ProxyInstallGuide | null;
  installGuideLoading: boolean;
  installInProgress: boolean;
  onCloseCertInstallModal: () => void;
  onSaveProxyCertificate: () => void;
  onInstallProxyCertificate: () => void;
  storageProfile?: Profile;
  runningInstances: InstanceInfoMap;
  storageProfileIsCurrent: boolean;
  storageInfo?: StorageBreakdown;
  storageLoading: boolean;
  cleanupInProgress: boolean;
  lastCleanupResult?: StorageCleanupResult;
  onRequestStorageInfo: (profileId: string) => void;
  onCleanStorage: (
    profileId: string,
    action: StorageCleanupAction,
    chatAgeDays?: number
  ) => void;
  onCloseStorageModal: () => void;
  showPricesModal: boolean;
  modelPricingData: ModelPricingDisplayData[];
  enabledModelPricingData: ModelPricingDisplayData[];
  pricingLoading: boolean;
  onClosePricesModal: () => void;
}

export const AppDialogs: React.FC<AppDialogsProps> = ({
  showImportDialog,
  onImport,
  onCloseImport,
  showAddForm,
  onAddProfile,
  onCloseAddForm,
  suggestedEmail,
  suggestedDisplayName,
  suggestedNotice,
  editingProfile,
  currentProfileId,
  onEditSubmit,
  onCloseEditForm,
  showUninstallConfirm,
  uninstallInProgress,
  onConfirmUninstall,
  onCloseUninstallConfirm,
  showCertInstallModal,
  installGuide,
  installGuideLoading,
  installInProgress,
  onCloseCertInstallModal,
  onSaveProxyCertificate,
  onInstallProxyCertificate,
  storageProfile,
  runningInstances,
  storageProfileIsCurrent,
  storageInfo,
  storageLoading,
  cleanupInProgress,
  lastCleanupResult,
  onRequestStorageInfo,
  onCleanStorage,
  onCloseStorageModal,
  showPricesModal,
  modelPricingData,
  enabledModelPricingData,
  pricingLoading,
  onClosePricesModal,
}) => (
  <>
    {showImportDialog && (
      <ImportDialog onImport={onImport} onCancel={onCloseImport} />
    )}

    {showAddForm && (
      <AddProfileForm
        onSubmit={onAddProfile}
        onCancel={onCloseAddForm}
        suggestedEmail={suggestedEmail}
        suggestedDisplayName={suggestedDisplayName}
        notice={suggestedNotice}
      />
    )}

    {editingProfile && (
      <EditProfileForm
        profile={editingProfile}
        isCurrent={editingProfile.id === currentProfileId}
        onSubmit={(updates) => onEditSubmit(editingProfile.id, updates)}
        onCancel={onCloseEditForm}
      />
    )}

    {showUninstallConfirm && (
      <CaCertificateUninstallModal
        inProgress={uninstallInProgress}
        onConfirm={onConfirmUninstall}
        onCancel={onCloseUninstallConfirm}
      />
    )}

    {showCertInstallModal && (
      <CaCertificateInstallModal
        guide={installGuide}
        loading={installGuideLoading}
        installInProgress={installInProgress}
        onClose={onCloseCertInstallModal}
        onSaveCertificate={onSaveProxyCertificate}
        onInstallCertificate={onInstallProxyCertificate}
      />
    )}

    {storageProfile && (
      <StorageManagementModal
        profile={storageProfile}
        isCurrent={storageProfileIsCurrent}
        isRunning={isProfileRunning(runningInstances, storageProfile.id)}
        storageInfo={storageInfo}
        storageLoading={storageLoading}
        cleanupInProgress={cleanupInProgress}
        lastCleanupResult={lastCleanupResult}
        onRequestStorageInfo={onRequestStorageInfo}
        onCleanStorage={onCleanStorage}
        onClose={onCloseStorageModal}
      />
    )}

    {showPricesModal && (
      <PricesModal
        models={modelPricingData}
        enabledModels={enabledModelPricingData}
        loading={pricingLoading}
        onClose={onClosePricesModal}
      />
    )}
  </>
);
