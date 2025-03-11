import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import AlertOwnerTeamService from "./AlertOwnerTeamService";
import AlertOwnerUserService from "./AlertOwnerUserService";
import AlertStateService from "./AlertStateService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import TeamMemberService from "./TeamMemberService";
import UserService from "./UserService";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Typeof from "../../Types/Typeof";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import Model from "Common/Models/DatabaseModels/Alert";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import { IsBillingEnabled } from "../EnvironmentConfig";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import logger from "../Utils/Logger";
import TelemetryUtil from "../Utils/Telemetry/Telemetry";
import MetricService from "./MetricService";
import OneUptimeDate from "../../Types/Date";
import Metric, {
  MetricPointType,
  ServiceType,
} from "../../Models/AnalyticsModels/Metric";
import AlertMetricType from "../../Types/Alerts/AlertMetricType";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "./AlertSeverityService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import AlertWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/Alert";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorService from "./MonitorService";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async isAlertAcknowledged(data: {
    alertId: ObjectID;
  }): Promise<boolean> {
    const alert: Model | null = await this.findOneBy({
      query: {
        _id: data.alertId,
      },
      select: {
        projectId: true,
        currentAlertState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found");
    }

    if (!alert.projectId) {
      throw new BadDataException("Incient Project ID not found");
    }

    const ackAlertState: AlertState =
      await AlertStateService.getAcknowledgedAlertState({
        projectId: alert.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentAlertStateOrder: number = alert.currentAlertState!.order!;
    const ackAlertStateOrder: number = ackAlertState.order!;

    if (currentAlertStateOrder >= ackAlertStateOrder) {
      return true;
    }

    return false;
  }

  public async getExistingAlertNumberForProject(data: {
    projectId: ObjectID;
  }): Promise<number> {
    // get last alert number.
    const lastAlert: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        alertNumber: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    if (!lastAlert) {
      return 0;
    }

    return lastAlert.alertNumber || 0;
  }

  public async acknowledgeAlert(
    alertId: ObjectID,
    acknowledgedByUserId: ObjectID,
  ): Promise<void> {
    const alert: Model | null = await this.findOneById({
      id: alertId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert || !alert.projectId) {
      throw new BadDataException("Alert not found.");
    }

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: alert.projectId,
        isAcknowledgedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alertState || !alertState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
    alertStateTimeline.projectId = alert.projectId;
    alertStateTimeline.alertId = alertId;
    alertStateTimeline.alertStateId = alertState.id;
    alertStateTimeline.createdByUserId = acknowledgedByUserId;

    await AlertStateTimelineService.create({
      data: alertStateTimeline,
      props: {
        isRoot: true,
      },
    });
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException("ProjectId required to create alert.");
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: projectId,
        isCreatedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alertState || !alertState.id) {
      throw new BadDataException(
        "Created alert state not found for this project. Please add created alert state from settings.",
      );
    }

    createBy.data.currentAlertStateId = alertState.id;

    const alertNumberForThisAlert: number =
      (await this.getExistingAlertNumberForProject({
        projectId: projectId,
      })) + 1;

    createBy.data.alertNumber = alertNumberForThisAlert;

    if (
      (createBy.data.createdByUserId ||
        createBy.data.createdByUser ||
        createBy.props.userId) &&
      !createBy.data.rootCause
    ) {
      let userId: ObjectID | undefined = createBy.data.createdByUserId;

      if (createBy.props.userId) {
        userId = createBy.props.userId;
      }

      if (createBy.data.createdByUser && createBy.data.createdByUser.id) {
        userId = createBy.data.createdByUser.id;
      }

      if (userId) {
        createBy.data.rootCause = `Alert created by ${await UserService.getUserMarkdownString(
          {
            userId: userId!,
            projectId: projectId,
          },
        )}`;
      }
    }

    return { createBy, carryForward: null };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    if (!createdItem.currentAlertStateId) {
      throw new BadDataException("currentAlertStateId is required");
    }

    const alert: Model | null = await this.findOneById({
      id: createdItem.id,
      select: {
        projectId: true,
        alertNumber: true,
        title: true,
        description: true,
        alertSeverity: {
          name: true,
        },
        rootCause: true,
        remediationNotes: true,
        currentAlertState: {
          name: true,
        },
        monitor: {
          name: true,
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Incident not found");
    }

    const createdByUserId: ObjectID | undefined | null =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    // send message to workspaces - slack, teams,   etc.
    const workspaceResult: {
      channelsCreated: Array<NotificationRuleWorkspaceChannel>;
    } | null =
      await AlertWorkspaceMessages.createChannelsAndInviteUsersToChannels({
        projectId: createdItem.projectId,
        alertId: createdItem.id!,
        alertNumber: createdItem.alertNumber!,
      });

    if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
      // update alert with these channels.
      await this.updateOneById({
        id: createdItem.id!,
        data: {
          postUpdatesToWorkspaceChannels: workspaceResult.channelsCreated || [],
        },
        props: {
          isRoot: true,
        },
      });
    }

    let feedInfoInMarkdown: string = `#### 🚨 Alert ${createdItem.alertNumber?.toString()} Created: 
         
   **${createdItem.title || "No title provided."}**:
   
   ${createdItem.description || "No description provided."}
   
   `;

    if (alert.currentAlertState?.name) {
      feedInfoInMarkdown += `🔴 **Alert State**: ${alert.currentAlertState.name} \n\n`;
    }

    if (alert.alertSeverity?.name) {
      feedInfoInMarkdown += `⚠️ **Severity**: ${alert.alertSeverity.name} \n\n`;
    }

    if (alert.monitor) {
      feedInfoInMarkdown += `🌎 **Resources Affected**:\n`;

      const monitor: Monitor = alert.monitor;
      feedInfoInMarkdown += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(createdItem.projectId!, monitor.id!)).toString()})\n`;

      feedInfoInMarkdown += `\n\n`;
    }

    if (createdItem.rootCause) {
      feedInfoInMarkdown += `\n
📄 **Root Cause**:
   
   ${createdItem.rootCause || "No root cause provided."}
   
   `;
    }

    if (createdItem.remediationNotes) {
      feedInfoInMarkdown += `\n 
🎯 **Remediation Notes**:
   
   ${createdItem.remediationNotes || "No remediation notes provided."}
   
   
   `;
    }

    const alertCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
      await AlertWorkspaceMessages.getAlertCreateMessageBlocks({
        alertId: createdItem.id!,
        projectId: createdItem.projectId!,
      });

    await AlertFeedService.createAlertFeedItem({
      alertId: createdItem.id!,
      projectId: createdItem.projectId!,
      alertFeedEventType: AlertFeedEventType.AlertCreated,
      displayColor: Red500,
      feedInfoInMarkdown: feedInfoInMarkdown,
      userId: createdByUserId || undefined,
      workspaceNotification: {
        appendMessageBlocks: alertCreateMessageBlocks,
        sendWorkspaceNotification: true,
      },
    });

    await this.changeAlertState({
      projectId: createdItem.projectId,
      alertId: createdItem.id,
      alertStateId: createdItem.currentAlertStateId,
      notifyOwners: false,
      rootCause: createdItem.rootCause,
      stateChangeLog: createdItem.createdStateLog,
      props: {
        isRoot: true,
      },
    });

    // add owners.

    if (
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId,
        createdItem.id,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        false,
        onCreate.createBy.props,
      );
    }

    if (
      createdItem.onCallDutyPolicies?.length &&
      createdItem.onCallDutyPolicies?.length > 0
    ) {
      for (const policy of createdItem.onCallDutyPolicies) {
        await OnCallDutyPolicyService.executePolicy(
          new ObjectID(policy._id as string),
          {
            triggeredByAlertId: createdItem.id!,
            userNotificationEventType: UserNotificationEventType.AlertCreated,
          },
        );
      }
    }

    return createdItem;
  }

  public async getWorkspaceChannelForAlert(data: {
    alertId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const alert: Model | null = await this.findOneById({
      id: data.alertId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found.");
    }

    return (alert.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  public async getAlertIdentifiedDate(alertId: ObjectID): Promise<Date> {
    const timeline: AlertStateTimeline | null =
      await AlertStateTimelineService.findOneBy({
        query: {
          alertId: alertId,
        },
        select: {
          startsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    if (!timeline || !timeline.startsAt) {
      throw new BadDataException("Alert identified date not found.");
    }

    return timeline.startsAt;
  }

  public async findOwners(alertId: ObjectID): Promise<Array<User>> {
    if (!alertId) {
      throw new BadDataException("alertId is required");
    }

    const ownerUsers: Array<AlertOwnerUser> =
      await AlertOwnerUserService.findBy({
        query: {
          alertId: alertId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<AlertOwnerTeam> =
      await AlertOwnerTeamService.findBy({
        query: {
          alertId: alertId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: AlertOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: AlertOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  public async addOwners(
    projectId: ObjectID,
    alertId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: AlertOwnerTeam = new AlertOwnerTeam();
      teamOwner.alertId = alertId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await AlertOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: AlertOwnerUser = new AlertOwnerUser();
      teamOwner.alertId = alertId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      teamOwner.isOwnerNotified = !notifyOwners;
      await AlertOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }

  public async getAlertLinkInDashboard(
    projectId: ObjectID,
    alertId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/alerts/${alertId.toString()}`,
    );
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.currentAlertStateId &&
      onUpdate.updateBy.props.tenantId
    ) {
      for (const itemId of updatedItemIds) {
        await this.changeAlertState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          alertId: itemId,
          alertStateId: onUpdate.updateBy.data.currentAlertStateId as ObjectID,
          notifyOwners: true,
          rootCause: "This status was changed when the alert was updated.",
          stateChangeLog: undefined,
          props: {
            isRoot: true,
          },
        });
      }
    }

    if (updatedItemIds.length > 0) {
      for (const alertId of updatedItemIds) {
        let shouldAddAlertFeed: boolean = false;
        let feedInfoInMarkdown: string = "**Alert was updated.**";

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        if (onUpdate.updateBy.data.title) {
          // add alert feed.

          feedInfoInMarkdown += `\n\n**Title**: 
${onUpdate.updateBy.data.title || "No title provided."}
`;
          shouldAddAlertFeed = true;
        }

        if (onUpdate.updateBy.data.rootCause) {
          if (onUpdate.updateBy.data.title) {
            // add alert feed.

            feedInfoInMarkdown += `\n\n**Root Cause**: 
${onUpdate.updateBy.data.rootCause || "No root cause provided."}
  `;
            shouldAddAlertFeed = true;
          }
        }

        if (onUpdate.updateBy.data.description) {
          // add alert feed.

          feedInfoInMarkdown += `\n\n**Alert Description**: 
          ${onUpdate.updateBy.data.description || "No description provided."}
          `;
          shouldAddAlertFeed = true;
        }

        if (onUpdate.updateBy.data.remediationNotes) {
          // add alert feed.

          feedInfoInMarkdown += `\n\n**Remediation Notes**: 
${onUpdate.updateBy.data.remediationNotes || "No remediation notes provided."}
        `;
          shouldAddAlertFeed = true;
        }

        if (
          onUpdate.updateBy.data.labels &&
          onUpdate.updateBy.data.labels.length > 0 &&
          Array.isArray(onUpdate.updateBy.data.labels)
        ) {
          const labelIds: Array<ObjectID> = (
            onUpdate.updateBy.data.labels as any
          )
            .map((label: Label) => {
              if (label._id) {
                return new ObjectID(label._id?.toString());
              }

              return null;
            })
            .filter((labelId: ObjectID | null) => {
              return labelId !== null;
            });

          const labels: Array<Label> = await LabelService.findBy({
            query: {
              _id: QueryHelper.any(labelIds),
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          if (labels.length > 0) {
            feedInfoInMarkdown += `\n\n**Labels**:

${labels
  .map((label: Label) => {
    return `- ${label.name}`;
  })
  .join("\n")}
`;

            shouldAddAlertFeed = true;
          }
        }

        if (
          onUpdate.updateBy.data.alertSeverity &&
          (onUpdate.updateBy.data.alertSeverity as any)._id
        ) {
          const alertSeverity: AlertSeverity | null =
            await AlertSeverityService.findOneBy({
              query: {
                _id: new ObjectID(
                  (onUpdate.updateBy.data.alertSeverity as any)?._id.toString(),
                ),
              },
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (alertSeverity) {
            feedInfoInMarkdown += `\n\n**Alert Severity**:
${alertSeverity.name}
`;

            shouldAddAlertFeed = true;
          }
        }

        if (shouldAddAlertFeed) {
          await AlertFeedService.createAlertFeedItem({
            alertId: alertId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            alertFeedEventType: AlertFeedEventType.AlertUpdated,
            displayColor: Gray500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: createdByUserId || undefined,
          });
        }
      }
    }

    return onUpdate;
  }

  public async doesMonitorHasMoreActiveManualAlerts(
    monitorId: ObjectID,
    proojectId: ObjectID,
  ): Promise<boolean> {
    const resolvedState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: proojectId,
        isResolvedState: true,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        order: true,
      },
    });

    const alertCount: PositiveNumber = await this.countBy({
      query: {
        monitorId: monitorId,
        currentAlertState: {
          order: QueryHelper.lessThan(resolvedState?.order as number),
        },
        isCreatedAutomatically: false,
      },
      props: {
        isRoot: true,
      },
    });

    return alertCount.toNumber() > 0;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const alerts: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        projectId: true,
        monitor: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return {
      deleteBy,
      carryForward: {
        alerts: alerts,
      },
    };
  }

  public async changeAlertState(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    alertStateId: ObjectID;
    notifyOwners: boolean;
    rootCause: string | undefined;
    stateChangeLog: JSONObject | undefined;
    props: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    const {
      projectId,
      alertId,
      alertStateId,
      notifyOwners,
      rootCause,
      stateChangeLog,
      props,
    } = data;

    // get last monitor status timeline.
    const lastAlertStatusTimeline: AlertStateTimeline | null =
      await AlertStateTimelineService.findOneBy({
        query: {
          alertId: alertId,
          projectId: projectId,
        },
        select: {
          _id: true,
          alertStateId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastAlertStatusTimeline &&
      lastAlertStatusTimeline.alertStateId &&
      lastAlertStatusTimeline.alertStateId.toString() ===
        alertStateId.toString()
    ) {
      return;
    }

    const statusTimeline: AlertStateTimeline = new AlertStateTimeline();

    statusTimeline.alertId = alertId;
    statusTimeline.alertStateId = alertStateId;
    statusTimeline.projectId = projectId;
    statusTimeline.isOwnerNotified = !notifyOwners;

    if (stateChangeLog) {
      statusTimeline.stateChangeLog = stateChangeLog;
    }
    if (rootCause) {
      statusTimeline.rootCause = rootCause;
    }

    await AlertStateTimelineService.create({
      data: statusTimeline,
      props: props || {},
    });
  }

  public async refreshAlertMetrics(data: { alertId: ObjectID }): Promise<void> {
    const alert: Model | null = await this.findOneById({
      id: data.alertId,
      select: {
        projectId: true,
        monitor: {
          _id: true,
          name: true,
        },
        alertSeverity: {
          name: true,
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found");
    }

    if (!alert.projectId) {
      throw new BadDataException("Incient Project ID not found");
    }

    // get alert state timeline

    const alertStateTimelines: Array<AlertStateTimeline> =
      await AlertStateTimelineService.findBy({
        query: {
          alertId: data.alertId,
        },
        select: {
          projectId: true,
          alertStateId: true,
          alertState: {
            isAcknowledgedState: true,
            isResolvedState: true,
          },
          startsAt: true,
          endsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const firstAlertStateTimeline: AlertStateTimeline | undefined =
      alertStateTimelines[0];

    // delete all the alert metrics with this alert id because its a refresh.

    await MetricService.deleteBy({
      query: {
        serviceId: data.alertId,
      },
      props: {
        isRoot: true,
      },
    });

    const itemsToSave: Array<Metric> = [];

    // now we need to create new metrics for this alert - TimeToAcknowledge, TimeToResolve, AlertCount, AlertDuration

    const alertStartsAt: Date =
      firstAlertStateTimeline?.startsAt ||
      alert.createdAt ||
      OneUptimeDate.getCurrentDate();

    const alertCountMetric: Metric = new Metric();

    alertCountMetric.projectId = alert.projectId;
    alertCountMetric.serviceId = alert.id!;
    alertCountMetric.serviceType = ServiceType.Alert;
    alertCountMetric.name = AlertMetricType.AlertCount;
    alertCountMetric.description = "Number of alerts created";
    alertCountMetric.value = 1;
    alertCountMetric.unit = "";
    alertCountMetric.attributes = {
      alertId: data.alertId.toString(),
      projectId: alert.projectId.toString(),
      monitorId: alert.monitor?.id!.toString() || "",
      monitorName: alert.monitor?.name!.toString() || "",
      alertSeverityId: alert.alertSeverity?.id!.toString() || "",
      alertSeverityName: alert.alertSeverity?.name!.toString() || "",
    };

    alertCountMetric.time = alertStartsAt;
    alertCountMetric.timeUnixNano = OneUptimeDate.toUnixNano(
      alertCountMetric.time,
    );
    alertCountMetric.metricPointType = MetricPointType.Sum;

    itemsToSave.push(alertCountMetric);

    // is the alert acknowledged?
    const isAlertAcknowledged: boolean = alertStateTimelines.some(
      (timeline: AlertStateTimeline) => {
        return timeline.alertState?.isAcknowledgedState;
      },
    );

    if (isAlertAcknowledged) {
      const ackAlertStateTimeline: AlertStateTimeline | undefined =
        alertStateTimelines.find((timeline: AlertStateTimeline) => {
          return timeline.alertState?.isAcknowledgedState;
        });

      if (ackAlertStateTimeline) {
        const timeToAcknowledgeMetric: Metric = new Metric();

        timeToAcknowledgeMetric.projectId = alert.projectId;
        timeToAcknowledgeMetric.serviceId = alert.id!;
        timeToAcknowledgeMetric.serviceType = ServiceType.Alert;
        timeToAcknowledgeMetric.name = AlertMetricType.TimeToAcknowledge;
        timeToAcknowledgeMetric.description =
          "Time taken to acknowledge the alert";
        timeToAcknowledgeMetric.value = OneUptimeDate.getDifferenceInSeconds(
          ackAlertStateTimeline?.startsAt || OneUptimeDate.getCurrentDate(),
          alertStartsAt,
        );
        timeToAcknowledgeMetric.unit = "seconds";
        timeToAcknowledgeMetric.attributes = {
          alertId: data.alertId.toString(),
          projectId: alert.projectId.toString(),
          monitorId: alert.monitor?.id!.toString() || "",
          monitorName: alert.monitor?.name!.toString() || "",
          alertSeverityId: alert.alertSeverity?.id!.toString() || "",
          alertSeverityName: alert.alertSeverity?.name!.toString() || "",
        };

        timeToAcknowledgeMetric.time =
          ackAlertStateTimeline?.startsAt ||
          alert.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToAcknowledgeMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToAcknowledgeMetric.time,
        );
        timeToAcknowledgeMetric.metricPointType = MetricPointType.Sum;

        itemsToSave.push(timeToAcknowledgeMetric);
      }
    }

    // time to resolve
    const isAlertResolved: boolean = alertStateTimelines.some(
      (timeline: AlertStateTimeline) => {
        return timeline.alertState?.isResolvedState;
      },
    );

    if (isAlertResolved) {
      const resolvedAlertStateTimeline: AlertStateTimeline | undefined =
        alertStateTimelines.find((timeline: AlertStateTimeline) => {
          return timeline.alertState?.isResolvedState;
        });

      if (resolvedAlertStateTimeline) {
        const timeToResolveMetric: Metric = new Metric();

        timeToResolveMetric.projectId = alert.projectId;
        timeToResolveMetric.serviceId = alert.id!;
        timeToResolveMetric.serviceType = ServiceType.Alert;
        timeToResolveMetric.name = AlertMetricType.TimeToResolve;
        timeToResolveMetric.description = "Time taken to resolve the alert";
        timeToResolveMetric.value = OneUptimeDate.getDifferenceInSeconds(
          resolvedAlertStateTimeline?.startsAt ||
            OneUptimeDate.getCurrentDate(),
          alertStartsAt,
        );
        timeToResolveMetric.unit = "seconds";
        timeToResolveMetric.attributes = {
          alertId: data.alertId.toString(),
          projectId: alert.projectId.toString(),
          monitorId: alert.monitor?.id!.toString() || "",
          monitorName: alert.monitor?.name!.toString() || "",
          alertSeverityId: alert.alertSeverity?.id!.toString() || "",
          alertSeverityName: alert.alertSeverity?.name!.toString() || "",
        };

        timeToResolveMetric.time =
          resolvedAlertStateTimeline?.startsAt ||
          alert.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToResolveMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToResolveMetric.time,
        );
        timeToResolveMetric.metricPointType = MetricPointType.Sum;

        itemsToSave.push(timeToResolveMetric);
      }
    }

    // alert duration

    const alertDurationMetric: Metric = new Metric();

    const lastAlertStateTimeline: AlertStateTimeline | undefined =
      alertStateTimelines[alertStateTimelines.length - 1];

    if (lastAlertStateTimeline) {
      const alertEndsAt: Date =
        lastAlertStateTimeline.startsAt || OneUptimeDate.getCurrentDate();

      // save metric.

      alertDurationMetric.projectId = alert.projectId;
      alertDurationMetric.serviceId = alert.id!;
      alertDurationMetric.serviceType = ServiceType.Alert;
      alertDurationMetric.name = AlertMetricType.AlertDuration;
      alertDurationMetric.description = "Duration of the alert";
      alertDurationMetric.value = OneUptimeDate.getDifferenceInSeconds(
        alertEndsAt,
        alertStartsAt,
      );
      alertDurationMetric.unit = "seconds";
      alertDurationMetric.attributes = {
        alertId: data.alertId.toString(),
        projectId: alert.projectId.toString(),
        monitorId: alert.monitor?.id!.toString() || "",
        monitorName: alert.monitor?.name!.toString() || "",
        alertSeverityId: alert.alertSeverity?.id!.toString() || "",
        alertSeverityName: alert.alertSeverity?.name!.toString() || "",
      };

      alertDurationMetric.time =
        lastAlertStateTimeline?.startsAt ||
        alert.createdAt ||
        OneUptimeDate.getCurrentDate();
      alertDurationMetric.timeUnixNano = OneUptimeDate.toUnixNano(
        alertDurationMetric.time,
      );
      alertDurationMetric.metricPointType = MetricPointType.Sum;
    }

    await MetricService.createMany({
      items: itemsToSave,
      props: {
        isRoot: true,
      },
    });

    // index attributes.
    TelemetryUtil.indexAttributes({
      attributes: ["monitorId", "projectId", "alertId", "monitorNames"],
      projectId: alert.projectId,
      telemetryType: TelemetryType.Metric,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }

  public async isAlertResolved(data: { alertId: ObjectID }): Promise<boolean> {
    const alert: Model | null = await this.findOneBy({
      query: {
        _id: data.alertId,
      },
      select: {
        projectId: true,
        currentAlertState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found");
    }

    if (!alert.projectId) {
      throw new BadDataException("Incient Project ID not found");
    }

    const resolvedAlertState: AlertState =
      await AlertStateService.getResolvedAlertState({
        projectId: alert.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentAlertStateOrder: number = alert.currentAlertState!.order!;
    const resolvedAlertStateOrder: number = resolvedAlertState.order!;

    if (currentAlertStateOrder >= resolvedAlertStateOrder) {
      return true;
    }

    return false;
  }

  public async getAlertNumber(data: {
    alertId: ObjectID;
  }): Promise<number | null> {
    const alert: Model | null = await this.findOneById({
      id: data.alertId,
      select: {
        alertNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found.");
    }

    return alert.alertNumber || null;
  }

  public async resolveAlert(
    alertId: ObjectID,
    resolvedByUserId: ObjectID,
  ): Promise<Model> {
    const alert: Model | null = await this.findOneById({
      id: alertId,
      select: {
        projectId: true,
        alertNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert || !alert.projectId) {
      throw new BadDataException("Alert not found.");
    }

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: alert.projectId,
        isResolvedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alertState || !alertState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
    alertStateTimeline.projectId = alert.projectId;
    alertStateTimeline.alertId = alertId;
    alertStateTimeline.alertStateId = alertState.id;
    alertStateTimeline.createdByUserId = resolvedByUserId;

    await AlertStateTimelineService.create({
      data: alertStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store alert metric

    return alert;
  }
}
export default new Service();
