import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import ScheduledMaintenanceOwnerTeamService from "./ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "./ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "./ScheduledMaintenanceStateTimelineService";
import TeamMemberService from "./TeamMemberService";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Typeof from "../../Types/Typeof";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Model from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import Recurring from "../../Types/Events/Recurring";
import OneUptimeDate from "../../Types/Date";
import UpdateBy from "../Types/Database/UpdateBy";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("createdAt", 120);
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (
      updateBy.query.id &&
      updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent
    ) {
      const scheduledMaintenance: Model | null =
        await this.findOneById({
          id: updateBy.query.id! as ObjectID,
          select: {
            startsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scheduledMaintenance) {
        throw new BadDataException("Scheduled Maintennace Event not found");
      }

      const startsAt: Date =
        (updateBy.data.startsAt as Date) ||
        (scheduledMaintenance.startsAt! as Date);

      const nextTimeToNotifyBeforeTheEvent: Date | null =
        this.getNextTimeToNotify({
          eventScheduledDate: startsAt,
          sendSubscriberNotifiationsOn: updateBy.data
            .sendSubscriberNotificationsOnBeforeTheEvent as Array<Recurring>,
        });

      updateBy.data.nextSubscriberNotificationBeforeTheEventAt =
        nextTimeToNotifyBeforeTheEvent;
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const scheduledMaintenanceEvents: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
        monitors: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return {
      carryForward: {
        scheduledMaintenanceEvents: scheduledMaintenanceEvents,
      },
      deleteBy: deleteBy,
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _deletedItemIds: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.carryForward?.scheduledMaintenanceEvents) {
      for (const scheduledMaintenanceEvent of onDelete?.carryForward
        ?.scheduledMaintenanceEvents || []) {
        await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
          scheduledMaintenanceEvent,
        );
      }
    }

    return onDelete;
  }

  public getNextTimeToNotify(data: {
    eventScheduledDate: Date;
    sendSubscriberNotifiationsOn: Array<Recurring>;
  }): Date | null {
    let recurringDate: Date | null = null;

    for (const recurringItem of data.sendSubscriberNotifiationsOn) {
      const notificationDate: Date = Recurring.getNextDateInterval(
        data.eventScheduledDate,
        recurringItem,
        true,
      );

      // if this date is in the future. set it to recurring date.
      if (OneUptimeDate.isInTheFuture(notificationDate)) {
        recurringDate = notificationDate;
      }

      // if this new date is less than the recurring date then set it to recuring date. We need to get the least date.

      if (recurringDate) {
        if (OneUptimeDate.isBefore(notificationDate, recurringDate)) {
          recurringDate = notificationDate;
        }
      }
    }

    return recurringDate;
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.tenantId && !createBy.data.projectId) {
      throw new BadDataException(
        "ProjectId required to create scheduled maintenane.",
      );
    }

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: createBy.props.tenantId,
          isScheduledState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
      throw new BadDataException(
        "Scheduled state not found for this project. Please add an scheduled event state from settings.",
      );
    }

    createBy.data.currentScheduledMaintenanceStateId =
      scheduledMaintenanceState.id;

    // get next notification date.

    if (
      createBy.data.sendSubscriberNotificationsOnBeforeTheEvent &&
      createBy.data.startsAt
    ) {
      const nextNotificationDate: Date | null = this.getNextTimeToNotify({
        eventScheduledDate: createBy.data.startsAt,
        sendSubscriberNotifiationsOn:
          createBy.data.sendSubscriberNotificationsOnBeforeTheEvent,
      });

      if (nextNotificationDate) {
        // set this.
        createBy.data.nextSubscriberNotificationBeforeTheEventAt =
          nextNotificationDate;
      }
    }

    return { createBy, carryForward: null };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // create new scheduled maintenance state timeline.

    const timeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    timeline.projectId = createdItem.projectId!;
    timeline.scheduledMaintenanceId = createdItem.id!;
    timeline.isOwnerNotified = true; // ignore notifying owners because you already notify for Scheduled Event, you don't have to notify them for timeline event.
    timeline.shouldStatusPageSubscribersBeNotified = Boolean(
      createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    );
    timeline.isStatusPageSubscribersNotified = Boolean(
      createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    ); // ignore notifying subscribers because you already notify for Scheduled Event, you don't have to notify them for timeline event.
    timeline.scheduledMaintenanceStateId =
      createdItem.currentScheduledMaintenanceStateId!;

    await ScheduledMaintenanceStateTimelineService.create({
      data: timeline,
      props: {
        isRoot: true,
      },
    });

    if (
      createdItem.projectId &&
      createdItem.id &&
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId!,
        createdItem.id!,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        false,
        onCreate.createBy.props,
      );
    }

    return createdItem;
  }

  public async addOwners(
    projectId: ObjectID,
    scheduledMaintenanceId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: ScheduledMaintenanceOwnerTeam =
        new ScheduledMaintenanceOwnerTeam();
      teamOwner.scheduledMaintenanceId = scheduledMaintenanceId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await ScheduledMaintenanceOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: ScheduledMaintenanceOwnerUser =
        new ScheduledMaintenanceOwnerUser();
      teamOwner.scheduledMaintenanceId = scheduledMaintenanceId;
      teamOwner.projectId = projectId;
      teamOwner.isOwnerNotified = !notifyOwners;
      teamOwner.userId = userId;
      await ScheduledMaintenanceOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }

  public async getScheduledMaintenanceLinkInDashboard(
    projectId: ObjectID,
    scheduledMaintenanceId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/scheduled-maintenance-events/${scheduledMaintenanceId.toString()}`,
    );
  }

  public async findOwners(
    scheduledMaintenanceId: ObjectID,
  ): Promise<Array<User>> {
    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    const ownerUsers: Array<ScheduledMaintenanceOwnerUser> =
      await ScheduledMaintenanceOwnerUserService.findBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
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

    const ownerTeams: Array<ScheduledMaintenanceOwnerTeam> =
      await ScheduledMaintenanceOwnerTeamService.findBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
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
      ownerUsers.map((ownerUser: ScheduledMaintenanceOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: ScheduledMaintenanceOwnerTeam) => {
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

  public async changeAttachedMonitorStates(
    item: Model,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    if (!item.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!item.id) {
      throw new BadDataException("id is required");
    }

    if (item.changeMonitorStatusToId && item.projectId) {
      // change status of all the monitors.
      await MonitorService.changeMonitorStatus(
        item.projectId,
        item.monitors?.map((monitor: Monitor) => {
          return new ObjectID(monitor._id || "");
        }) || [],
        item.changeMonitorStatusToId,
        true, // notify owners
        "Changed because of scheduled maintenance event: " + item.id.toString(),
        undefined,
        props,
      );
    }
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.currentScheduledMaintenanceStateId &&
      onUpdate.updateBy.props.tenantId
    ) {
      for (const itemId of updatedItemIds) {
        await this.changeScheduledMaintenanceState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          scheduledMaintenanceId: itemId,
          scheduledMaintenanceStateId: onUpdate.updateBy.data
            .currentScheduledMaintenanceStateId as ObjectID,
          shouldNotifyStatusPageSubscribers: true,
          isSubscribersNotified: false,
          notifyOwners: true, // notifyOwners = true
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onUpdate;
  }

  public async changeScheduledMaintenanceState(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    scheduledMaintenanceStateId: ObjectID;
    shouldNotifyStatusPageSubscribers: boolean;
    isSubscribersNotified: boolean;
    notifyOwners: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const {
      projectId,
      scheduledMaintenanceId,
      scheduledMaintenanceStateId,
      notifyOwners,
      shouldNotifyStatusPageSubscribers,
      isSubscribersNotified,
      props,
    } = data;

    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    if (!scheduledMaintenanceStateId) {
      throw new BadDataException("scheduledMaintenanceStateId is required");
    }

    // get last scheduled status timeline.
    const lastState: ScheduledMaintenanceStateTimeline | null =
      await ScheduledMaintenanceStateTimelineService.findOneBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: projectId,
        },
        select: {
          _id: true,
          scheduledMaintenanceStateId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastState &&
      lastState.scheduledMaintenanceStateId &&
      lastState.scheduledMaintenanceStateId.toString() ===
        scheduledMaintenanceStateId.toString()
    ) {
      return;
    }

    const statusTimeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();

    statusTimeline.scheduledMaintenanceId = scheduledMaintenanceId;
    statusTimeline.scheduledMaintenanceStateId = scheduledMaintenanceStateId;
    statusTimeline.projectId = projectId;
    statusTimeline.isOwnerNotified = !notifyOwners;
    statusTimeline.isStatusPageSubscribersNotified = isSubscribersNotified;
    statusTimeline.shouldStatusPageSubscribersBeNotified =
      shouldNotifyStatusPageSubscribers;

    await ScheduledMaintenanceStateTimelineService.create({
      data: statusTimeline,
      props: props,
    });

    await this.updateBy({
      data: {
        currentScheduledMaintenanceStateId: scheduledMaintenanceStateId.id,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      query: {
        _id: scheduledMaintenanceId.toString()!,
      },
      props: {
        isRoot: true,
      },
    });
  }
}
export default new Service();
