/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { ETabIndices } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TProject,
  TProjectTemplate,
  TProjectTemplateLabel,
  TProjectTemplateSnapshot,
  TProjectTemplateState,
  TProjectTemplateWorkItem,
} from "@plane/types";
import { Input, TextArea } from "@plane/ui";
import { getTabIndex } from "@plane/utils";
import ProjectCreateHeader from "@/components/project/create/header";
import { ProjectDropdown } from "@/components/dropdowns/project/dropdown";
import { ProjectAttributes } from "@/components/projects/create/attributes";
import { getProjectFormValues } from "@/components/projects/create/utils";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useProjectTemplates } from "@/plane-web/hooks/store/use-project-templates";
import { ProjectTemplateSnapshotFields } from "./project-template-snapshot-fields";

export type TCreateProjectTemplateFormValues = TProject & {
  project_id: string | null;
  states: TProjectTemplateState[];
  labels: TProjectTemplateLabel[];
  work_items: TProjectTemplateWorkItem[];
};

const FEATURE_DEFAULTS = {
  module_view: true,
  cycle_view: true,
  issue_views_view: true,
  page_view: true,
  inbox_view: false,
};

const getDefaultFormValues = (): TCreateProjectTemplateFormValues => ({
  ...getProjectFormValues(),
  ...FEATURE_DEFAULTS,
  // Identifier is a create-project field, not part of templates (Plane docs).
  identifier: "TMPL",
  project_id: null,
  states: [],
  labels: [],
  work_items: [],
});

const getFormValuesFromSnapshot = (
  snapshot: TProjectTemplateSnapshot,
  projectId: string | null = null
): TCreateProjectTemplateFormValues => {
  const projectLead =
    snapshot.project_lead && typeof snapshot.project_lead === "object" && "id" in snapshot.project_lead
      ? String(snapshot.project_lead.id)
      : null;

  return {
    ...getDefaultFormValues(),
    name: snapshot.name || "",
    description: snapshot.description || "",
    cover_image_url: snapshot.cover_image || getProjectFormValues().cover_image_url,
    network: snapshot.network ?? 2,
    logo_props: (snapshot.logo_props as TProject["logo_props"]) || getProjectFormValues().logo_props,
    project_lead: projectLead,
    module_view: snapshot.module_view ?? true,
    cycle_view: snapshot.cycle_view ?? true,
    issue_views_view: snapshot.issue_views_view ?? true,
    page_view: snapshot.page_view ?? true,
    inbox_view: snapshot.intake_view ?? false,
    states: snapshot.states ?? [],
    labels: snapshot.labels ?? [],
    work_items: snapshot.work_items ?? [],
    project_id: projectId,
  };
};

const getFormValuesFromTemplate = (template: TProjectTemplate): TCreateProjectTemplateFormValues => {
  const snapshot = template.template_data?.[0];
  if (!snapshot) {
    return {
      ...getDefaultFormValues(),
      name: template.name || "",
      description: template.description || "",
      cover_image_url: template.cover_image || getProjectFormValues().cover_image_url,
    };
  }

  return {
    ...getFormValuesFromSnapshot(snapshot),
    name: template.name || snapshot.name || "",
    description: template.description || snapshot.description || "",
    cover_image_url: template.cover_image || snapshot.cover_image || getProjectFormValues().cover_image_url,
    project_id: null,
  };
};

const buildTemplateData = (formData: TCreateProjectTemplateFormValues) => {
  const projectLeadId =
    typeof formData.project_lead === "string"
      ? formData.project_lead
      : formData.project_lead && typeof formData.project_lead === "object"
        ? formData.project_lead.id
        : undefined;

  return {
    name: formData.name.trim(),
    description: formData.description?.trim() || "",
    network: formData.network,
    logo_props: formData.logo_props,
    cover_image: formData.cover_image_url || "",
    project_lead: projectLeadId ? { id: projectLeadId } : {},
    module_view: Boolean(formData.module_view),
    cycle_view: Boolean(formData.cycle_view),
    issue_views_view: Boolean(formData.issue_views_view),
    page_view: Boolean(formData.page_view),
    intake_view: Boolean(formData.inbox_view),
    states: formData.states.filter((state) => state.name.trim()),
    labels: formData.labels.filter((label) => label.name.trim()),
    work_items: formData.work_items.filter((item) => item.name.trim()),
  };
};

type Props = {
  workspaceSlug: string;
  onClose: () => void;
  onSuccess?: () => void;
  template?: TProjectTemplate | null;
};

export const CreateProjectTemplateForm = observer(function CreateProjectTemplateForm(props: Props) {
  const { workspaceSlug, onClose, onSuccess, template = null } = props;
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const { createTemplate, updateTemplate, previewFromProject } = useProjectTemplates();
  const { getIndex } = getTabIndex(ETabIndices.PROJECT_CREATE, isMobile);
  const isEditMode = Boolean(template);
  const [isPrefilling, setIsPrefilling] = useState(false);

  const methods = useForm<TCreateProjectTemplateFormValues>({
    defaultValues: template ? getFormValuesFromTemplate(template) : getDefaultFormValues(),
    reValidateMode: "onChange",
  });
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = methods;

  useEffect(() => {
    reset(template ? getFormValuesFromTemplate(template) : getDefaultFormValues());
  }, [template, reset]);

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      reset(getDefaultFormValues());
    }, 300);
  };

  const handleSourceProjectChange = async (projectId: string) => {
    setIsPrefilling(true);
    try {
      const snapshot = await previewFromProject(workspaceSlug, projectId);
      reset(getFormValuesFromSnapshot(snapshot, projectId));
    } catch {
      reset({
        ...getDefaultFormValues(),
        project_id: projectId,
      });
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("something_went_wrong_please_try_again"),
      });
    } finally {
      setIsPrefilling(false);
    }
  };

  const onSubmit = async (formData: TCreateProjectTemplateFormValues) => {
    try {
      const templateData = buildTemplateData(formData);
      const projectId = formData.project_id || undefined;

      if (isEditMode && template) {
        await updateTemplate(workspaceSlug, template.id, {
          name: formData.name.trim(),
          description: formData.description?.trim() || "",
          cover_image: formData.cover_image_url || "",
          template_data: templateData,
        });
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("success"),
          message: t("templates.settings.form.project.button.update"),
        });
      } else {
        await createTemplate(workspaceSlug, {
          name: formData.name.trim(),
          description: formData.description?.trim() || "",
          cover_image: formData.cover_image_url || "",
          project_id: projectId,
          template_data: projectId
            ? {
                ...templateData,
                states: templateData.states.length ? templateData.states : undefined,
                labels: templateData.labels.length ? templateData.labels : undefined,
                work_items: templateData.work_items.length ? templateData.work_items : undefined,
              }
            : templateData,
        });
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("success"),
          message: t("templates.toasts.create.success.title"),
        });
      }
      onSuccess?.();
      handleClose();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("something_went_wrong_please_try_again"),
      });
    }
  };

  return (
    <FormProvider {...methods}>
      <ProjectCreateHeader handleClose={handleClose} isMobile={isMobile} showActionButtons={false} />

      <form
        onSubmit={(e) => {
          // Nested state editors use native <button>s that would otherwise submit this form.
          e.preventDefault();
        }}
        className="px-3"
      >
        <div className="mt-9 space-y-6 pb-5">
          {!isEditMode && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-secondary">
                {t("templates.settings.form.project.source_project.label")}
              </p>
              <Controller
                control={control}
                name="project_id"
                render={({ field: { value } }) => (
                  <div className="h-7">
                    <ProjectDropdown
                      value={value}
                      onChange={(projectId) => {
                        void handleSourceProjectChange(projectId);
                      }}
                      multiple={false}
                      buttonVariant="border-with-text"
                      placeholder={t("templates.settings.form.project.source_project.placeholder")}
                      tabIndex={getIndex("cover_image")}
                      disabled={isPrefilling}
                    />
                  </div>
                )}
              />
              <p className="text-xs text-tertiary">
                {isPrefilling ? t("loading") : t("templates.settings.form.project.source_project.helper")}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1">
              <Controller
                control={control}
                name="name"
                rules={{
                  required: t("templates.settings.form.project.template.name.validation.required"),
                  maxLength: {
                    value: 255,
                    message: t("templates.settings.form.project.template.name.validation.maxLength"),
                  },
                }}
                render={({ field: { value, onChange } }) => (
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    value={value}
                    onChange={onChange}
                    hasError={Boolean(errors.name)}
                    placeholder={t("templates.settings.form.project.template.name.placeholder")}
                    className="w-full"
                    tabIndex={getIndex("name")}
                    disabled={isPrefilling}
                  />
                )}
              />
              {errors.name?.message ? <span className="text-11 text-danger-primary">{errors.name.message}</span> : null}
            </div>
            <Controller
              name="description"
              control={control}
              render={({ field: { value, onChange } }) => (
                <TextArea
                  id="description"
                  name="description"
                  value={value}
                  placeholder={t("templates.settings.form.project.template.description.placeholder")}
                  onChange={onChange}
                  className="!h-24 w-full text-13"
                  hasError={Boolean(errors.description)}
                  tabIndex={getIndex("description")}
                  disabled={isPrefilling}
                />
              )}
            />
          </div>

          <ProjectAttributes isMobile={isMobile} />
          <ProjectTemplateSnapshotFields />
        </div>

        <div className="flex justify-end gap-2 border-t border-subtle py-4">
          <Button variant="secondary" size="lg" onClick={handleClose} tabIndex={getIndex("cancel")}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="lg"
            type="button"
            loading={isSubmitting || isPrefilling}
            tabIndex={getIndex("submit")}
            onClick={handleSubmit(onSubmit)}
          >
            {isEditMode
              ? t("templates.settings.form.project.button.update")
              : t("templates.settings.form.project.button.create")}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
});
