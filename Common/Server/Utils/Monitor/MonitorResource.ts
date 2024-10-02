import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import MonitorMetricsByMinuteService from "../../Services/MonitorMetricsByMinuteService";
import MonitorProbeService from "../../Services/MonitorProbeService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import logger from "../Logger";
import VMUtil from "../VM/VMAPI";
import APIRequestCriteria from "./Criteria/APIRequestCriteria";
import CustomCodeMonitoringCriteria from "./Criteria/CustomCodeMonitorCriteria";
import IncomingRequestCriteria from "./Criteria/IncomingRequestCriteria";
import SSLMonitorCriteria from "./Criteria/SSLMonitorCriteria";
import ServerMonitorCriteria from "./Criteria/ServerMonitorCriteria";
import SyntheticMonitoringCriteria from "./Criteria/SyntheticMonitor";
import DataToProcess from "./DataToProcess";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import BasicInfrastructureMetrics from "Common/Types/Infrastructure/BasicMetrics";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import { JSONObject } from "Common/Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterCondition,
} from "Common/Types/Monitor/CriteriaFilter";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Typeof from "Common/Types/Typeof";
import MonitorMetricsByMinute from "Common/Models/AnalyticsModels/MonitorMetricsByMinute";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OneUptimeDate from "Common/Types/Date";
import LogMonitorCriteria from "./Criteria/LogMonitorCriteria";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import TraceMonitorCriteria from "./Criteria/TraceMonitorCriteria";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";

export default class MonitorResourceUtil {
  public static async monitorResource(
    dataToProcess: DataToProcess,
  ): Promise<ProbeApiIngestResponse> {
    let response: ProbeApiIngestResponse = {
      monitorId: dataToProcess.monitorId,
      criteriaMetId: undefined,
      rootCause: null,
    };

    logger.debug("Processing probe response");
    logger.debug("Monitor ID: " + dataToProcess.monitorId);
    logger.debug("Fetching Monitor...");

    // fetch monitor
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: dataToProcess.monitorId,
      select: {
        monitorSteps: true,
        monitorType: true,
        projectId: true,
        disableActiveMonitoring: true,
        disableActiveMonitoringBecauseOfManualIncident: true,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        currentMonitorStatusId: true,
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    logger.debug("Monitor found");
    logger.debug("Monitor ID: " + dataToProcess.monitorId);

    if (!monitor) {
      logger.debug(`${dataToProcess.monitorId.toString()} Monitor not found`);
      throw new BadDataException("Monitor not found");
    }

    if (monitor.disableActiveMonitoring) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} Monitor is disabled. Please enable it to start monitoring again.`,
      );

      throw new BadDataException(
        "Monitor is disabled. Please enable it to start monitoring again.",
      );
    }

    if (monitor.disableActiveMonitoringBecauseOfManualIncident) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} Monitor is disabled because an incident which is created manually is not resolved. Please resolve the incident to start monitoring again.`,
      );

      throw new BadDataException(
        "Monitor is disabled because an incident which is created manually is not resolved. Please resolve the incident to start monitoring again.",
      );
    }

    if (monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} Monitor is disabled because one of the scheduled maintenance event this monitor is attached to has not ended. Please end the scheduled maintenance event to start monitoring again.`,
      );

      throw new BadDataException(
        "Monitor is disabled because one of the scheduled maintenance event this monitor is attached to has not ended. Please end the scheduled maintenance event to start monitoring again.",
      );
    }

    // save the last log to MonitorProbe.

    // get last log. We do this because there are many monitoring steps and we need to store those.
    logger.debug(
      `${dataToProcess.monitorId.toString()} - monitor type ${
        monitor.monitorType
      }`,
    );

    if (
      monitor.monitorType &&
      MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
    ) {
      dataToProcess = dataToProcess as ProbeMonitorResponse;
      if ((dataToProcess as ProbeMonitorResponse).probeId) {
        const monitorProbe: MonitorProbe | null =
          await MonitorProbeService.findOneBy({
            query: {
              monitorId: monitor.id!,
              probeId: (dataToProcess as ProbeMonitorResponse).probeId!,
            },
            select: {
              lastMonitoringLog: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!monitorProbe) {
          throw new BadDataException("Probe is not assigned to this monitor");
        }

        await MonitorProbeService.updateOneBy({
          query: {
            monitorId: monitor.id!,
            probeId: (dataToProcess as ProbeMonitorResponse).probeId!,
          },
          data: {
            lastMonitoringLog: {
              ...(monitorProbe.lastMonitoringLog || {}),
              [(
                dataToProcess as ProbeMonitorResponse
              ).monitorStepId.toString()]: {
                ...JSON.parse(JSON.stringify(dataToProcess)),
                monitoredAt: OneUptimeDate.getCurrentDate(),
              },
            } as any,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    if (
      monitor.monitorType === MonitorType.IncomingRequest &&
      (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Incoming request received at ${(dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt}`,
      );

      await MonitorService.updateOneById({
        id: monitor.id!,
        data: {
          incomingMonitorRequest: dataToProcess as any,
          incomingRequestReceivedAt: (dataToProcess as IncomingMonitorRequest)
            .incomingRequestReceivedAt!, // this could be redundant as we are already saving this in the incomingMonitorRequest. we should remove this in the future.
        },
        props: {
          isRoot: true,
        },
      });

      logger.debug(`${dataToProcess.monitorId.toString()} - Monitor Updated`);
    }

    if (
      monitor.monitorType === MonitorType.Server &&
      (dataToProcess as ServerMonitorResponse).requestReceivedAt
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Server request received at ${(dataToProcess as ServerMonitorResponse).requestReceivedAt}`,
      );

      logger.debug(dataToProcess);

      await MonitorService.updateOneById({
        id: monitor.id!,
        data: {
          serverMonitorRequestReceivedAt: (
            dataToProcess as ServerMonitorResponse
          ).requestReceivedAt!,
          serverMonitorResponse: dataToProcess as ServerMonitorResponse, // this could be redundant as we are already saving this in the incomingMonitorRequest. we should remove this in the future.
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      logger.debug(`${dataToProcess.monitorId.toString()} - Monitor Updated`);
    }

    logger.debug(
      `${dataToProcess.monitorId.toString()} - Saving monitor metrics`,
    );

    try {
      await this.saveMonitorMetrics({
        monitorId: monitor.id!,
        projectId: monitor.projectId!,
        dataToProcess: dataToProcess,
      });
    } catch (err) {
      logger.error("Unable to save metrics");
      logger.error(err);
    }

    logger.debug(
      `${dataToProcess.monitorId.toString()} - Monitor metrics saved`,
    );

    const monitorSteps: MonitorSteps = monitor.monitorSteps!;

    if (
      !monitorSteps.data?.monitorStepsInstanceArray ||
      monitorSteps.data?.monitorStepsInstanceArray.length === 0
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - No monitoring steps.`,
      );
      return response;
    }

    logger.debug(
      `${dataToProcess.monitorId.toString()} - Auto resolving criteria instances.`,
    );

    const criteriaInstances: Array<MonitorCriteriaInstance> =
      monitorSteps.data.monitorStepsInstanceArray
        .map((step: MonitorStep) => {
          return step.data?.monitorCriteria;
        })
        .filter((criteria: MonitorCriteria | undefined) => {
          return Boolean(criteria);
        })
        .map((criteria: MonitorCriteria | undefined) => {
          return [...(criteria?.data?.monitorCriteriaInstanceArray || [])];
        })
        .flat();

    const autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    > = {};
    const criteriaInstanceMap: Dictionary<MonitorCriteriaInstance> = {};
    for (const criteriaInstance of criteriaInstances) {
      criteriaInstanceMap[criteriaInstance.data?.id || ""] = criteriaInstance;

      if (
        criteriaInstance.data?.incidents &&
        criteriaInstance.data?.incidents.length > 0
      ) {
        for (const incidentTemplate of criteriaInstance.data!.incidents) {
          if (incidentTemplate.autoResolveIncident) {
            if (
              !autoResolveCriteriaInstanceIdIncidentIdsDictionary[
                criteriaInstance.data.id.toString()
              ]
            ) {
              autoResolveCriteriaInstanceIdIncidentIdsDictionary[
                criteriaInstance.data.id.toString()
              ] = [];
            }

            autoResolveCriteriaInstanceIdIncidentIdsDictionary[
              criteriaInstance.data.id.toString()
            ]?.push(incidentTemplate.id);
          }
        }
      }
    }

    const monitorStep: MonitorStep | undefined =
      monitorSteps.data.monitorStepsInstanceArray[0];

    logger.debug(`Monitor Step: ${monitorStep ? monitorStep.id : "undefined"}`);

    if ((dataToProcess as ProbeMonitorResponse).monitorStepId) {
      monitorSteps.data.monitorStepsInstanceArray.find(
        (monitorStep: MonitorStep) => {
          return (
            monitorStep.id.toString() ===
            (dataToProcess as ProbeMonitorResponse).monitorStepId.toString()
          );
        },
      );
      logger.debug(
        `Found Monitor Step ID: ${(dataToProcess as ProbeMonitorResponse).monitorStepId}`,
      );
    }

    if (!monitorStep) {
      logger.debug("No steps found, ignoring everything.");
      return response;
    }

    // now process the monitor step
    response.ingestedMonitorStepId = monitorStep.id;
    logger.debug(`Ingested Monitor Step ID: ${monitorStep.id}`);

    //find next monitor step after this one.
    const nextMonitorStepIndex: number =
      monitorSteps.data.monitorStepsInstanceArray.findIndex(
        (step: MonitorStep) => {
          return step.id.toString() === monitorStep.id.toString();
        },
      );

    response.nextMonitorStepId =
      monitorSteps.data.monitorStepsInstanceArray[nextMonitorStepIndex + 1]?.id;

    logger.debug(`Next Monitor Step ID: ${response.nextMonitorStepId}`);

    // now process probe response monitors
    logger.debug(
      `${dataToProcess.monitorId.toString()} - Processing monitor step...`,
    );
    response = await MonitorResourceUtil.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: response,
    });

    if (response.criteriaMetId && response.rootCause) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Criteria met: ${
          response.criteriaMetId
        }`,
      );
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Root cause: ${
          response.rootCause
        }`,
      );

      let telemetryQuery: TelemetryQuery | undefined = undefined;

      if (dataToProcess && (dataToProcess as LogMonitorResponse).logQuery) {
        telemetryQuery = {
          telemetryQuery: (dataToProcess as LogMonitorResponse).logQuery,
          telemetryType: TelemetryType.Log,
        };
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Log query found.`,
        );
      }

      if (dataToProcess && (dataToProcess as TraceMonitorResponse).spanQuery) {
        telemetryQuery = {
          telemetryQuery: (dataToProcess as TraceMonitorResponse).spanQuery,
          telemetryType: TelemetryType.Trace,
        };
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Span query found.`,
        );
      }

      await this.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        monitor: monitor,
        rootCause: response.rootCause,
        dataToProcess: dataToProcess,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        criteriaInstance: criteriaInstanceMap[response.criteriaMetId!]!,
        props: {
          telemetryQuery: telemetryQuery,
        },
      });
    } else if (
      !response.criteriaMetId &&
      monitorSteps.data.defaultMonitorStatusId &&
      monitor.currentMonitorStatusId?.toString() !==
        monitorSteps.data.defaultMonitorStatusId.toString()
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - No criteria met. Change to default status.`,
      );

      await this.checkOpenIncidentsAndCloseIfResolved({
        monitorId: monitor.id!,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        rootCause: "No monitoring criteria met. Change to default status.",
        criteriaInstance: null, // no criteria met!
        dataToProcess: dataToProcess,
      });

      // get last monitor status timeline.
      const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
        await MonitorStatusTimelineService.findOneBy({
          query: {
            monitorId: monitor.id!,
            projectId: monitor.projectId!,
          },
          select: {
            _id: true,
            monitorStatusId: true,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        lastMonitorStatusTimeline &&
        lastMonitorStatusTimeline.monitorStatusId &&
        lastMonitorStatusTimeline.monitorStatusId.toString() ===
          monitorSteps.data.defaultMonitorStatusId.toString()
      ) {
        // status is same as last status. do not create new status timeline.
        // do nothing! status is same as last status.
      } else {
        // if no criteria is met then update monitor to default state.
        const monitorStatusTimeline: MonitorStatusTimeline =
          new MonitorStatusTimeline();
        monitorStatusTimeline.monitorId = monitor.id!;
        monitorStatusTimeline.monitorStatusId =
          monitorSteps.data.defaultMonitorStatusId!;
        monitorStatusTimeline.projectId = monitor.projectId!;
        monitorStatusTimeline.statusChangeLog = JSON.parse(
          JSON.stringify(dataToProcess),
        );
        monitorStatusTimeline.rootCause =
          "No monitoring criteria met. Change to default status. ";

        await MonitorStatusTimelineService.create({
          data: monitorStatusTimeline,
          props: {
            isRoot: true,
          },
        });
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Monitor status updated to default.`,
        );
      }
    }

    return response;
  }

  public static async saveMonitorMetrics(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    dataToProcess: DataToProcess;
  }): Promise<void> {
    if (!data.monitorId) {
      return;
    }

    if (!data.projectId) {
      return;
    }

    if (!data.dataToProcess) {
      return;
    }

    const itemsToSave: Array<MonitorMetricsByMinute> = [];

    if (
      (data.dataToProcess as ServerMonitorResponse).basicInfrastructureMetrics
    ) {
      // store cpu, memory, disk metrics.

      if ((data.dataToProcess as ServerMonitorResponse).requestReceivedAt) {
        let isOnline: boolean = true;

        const differenceInMinutes: number =
          OneUptimeDate.getDifferenceInMinutes(
            (data.dataToProcess as ServerMonitorResponse).requestReceivedAt,
            OneUptimeDate.getCurrentDate(),
          );

        if (differenceInMinutes > 2) {
          isOnline = false;
        }

        const monitorMetricsByMinute: MonitorMetricsByMinute =
          new MonitorMetricsByMinute();

        monitorMetricsByMinute.monitorId = data.monitorId;
        monitorMetricsByMinute.projectId = data.projectId;
        monitorMetricsByMinute.metricType = CheckOn.IsOnline;
        monitorMetricsByMinute.metricValue = isOnline ? 1 : 0;

        itemsToSave.push(monitorMetricsByMinute);
      }

      const basicMetrics: BasicInfrastructureMetrics | undefined = (
        data.dataToProcess as ServerMonitorResponse
      ).basicInfrastructureMetrics;

      if (!basicMetrics) {
        return;
      }

      if (basicMetrics.cpuMetrics) {
        const monitorMetricsByMinute: MonitorMetricsByMinute =
          new MonitorMetricsByMinute();
        monitorMetricsByMinute.monitorId = data.monitorId;
        monitorMetricsByMinute.projectId = data.projectId;
        monitorMetricsByMinute.metricType = CheckOn.CPUUsagePercent;
        monitorMetricsByMinute.metricValue =
          basicMetrics.cpuMetrics.percentUsed;

        itemsToSave.push(monitorMetricsByMinute);
      }

      if (basicMetrics.memoryMetrics) {
        const monitorMetricsByMinute: MonitorMetricsByMinute =
          new MonitorMetricsByMinute();
        monitorMetricsByMinute.monitorId = data.monitorId;
        monitorMetricsByMinute.projectId = data.projectId;
        monitorMetricsByMinute.metricType = CheckOn.MemoryUsagePercent;
        monitorMetricsByMinute.metricValue =
          basicMetrics.memoryMetrics.percentUsed;

        itemsToSave.push(monitorMetricsByMinute);
      }

      if (basicMetrics.diskMetrics && basicMetrics.diskMetrics.length > 0) {
        for (const diskMetric of basicMetrics.diskMetrics) {
          const monitorMetricsByMinute: MonitorMetricsByMinute =
            new MonitorMetricsByMinute();
          monitorMetricsByMinute.monitorId = data.monitorId;
          monitorMetricsByMinute.projectId = data.projectId;
          monitorMetricsByMinute.metricType = CheckOn.DiskUsagePercent;
          monitorMetricsByMinute.metricValue = diskMetric.percentUsed;
          monitorMetricsByMinute.miscData = {
            diskPath: diskMetric.diskPath,
          };

          itemsToSave.push(monitorMetricsByMinute);
        }
      }
    }

    if ((data.dataToProcess as ProbeMonitorResponse).responseTimeInMs) {
      const monitorMetricsByMinute: MonitorMetricsByMinute =
        new MonitorMetricsByMinute();
      monitorMetricsByMinute.monitorId = data.monitorId;
      monitorMetricsByMinute.projectId = data.projectId;
      monitorMetricsByMinute.metricType = CheckOn.ResponseTime;
      monitorMetricsByMinute.metricValue = (
        data.dataToProcess as ProbeMonitorResponse
      ).responseTimeInMs;
      monitorMetricsByMinute.miscData = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      itemsToSave.push(monitorMetricsByMinute);
    }

    if ((data.dataToProcess as ProbeMonitorResponse).isOnline !== undefined) {
      const monitorMetricsByMinute: MonitorMetricsByMinute =
        new MonitorMetricsByMinute();
      monitorMetricsByMinute.monitorId = data.monitorId;
      monitorMetricsByMinute.projectId = data.projectId;
      monitorMetricsByMinute.metricType = CheckOn.IsOnline;
      monitorMetricsByMinute.metricValue = 0;
      monitorMetricsByMinute.miscData = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      if ((data.dataToProcess as ProbeMonitorResponse).isOnline) {
        monitorMetricsByMinute.metricValue = 1;
      }

      itemsToSave.push(monitorMetricsByMinute);
    }

    if ((data.dataToProcess as ProbeMonitorResponse).responseCode) {
      const monitorMetricsByMinute: MonitorMetricsByMinute =
        new MonitorMetricsByMinute();
      monitorMetricsByMinute.monitorId = data.monitorId;
      monitorMetricsByMinute.projectId = data.projectId;
      monitorMetricsByMinute.metricType = CheckOn.ResponseStatusCode;
      monitorMetricsByMinute.metricValue = (
        data.dataToProcess as ProbeMonitorResponse
      ).responseCode;
      monitorMetricsByMinute.miscData = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      itemsToSave.push(monitorMetricsByMinute);
    }

    if ((data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse) {
      for (const syntheticMonitorResponse of (
        data.dataToProcess as ProbeMonitorResponse
      ).syntheticMonitorResponse || []) {
        const monitorMetricsByMinute: MonitorMetricsByMinute =
          new MonitorMetricsByMinute();
        monitorMetricsByMinute.monitorId = data.monitorId;
        monitorMetricsByMinute.projectId = data.projectId;
        monitorMetricsByMinute.metricType = CheckOn.ExecutionTime;
        monitorMetricsByMinute.metricValue =
          syntheticMonitorResponse.executionTimeInMS;
        monitorMetricsByMinute.miscData = {
          probeId: (
            data.dataToProcess as ProbeMonitorResponse
          ).probeId.toString(),
          browserType: syntheticMonitorResponse.browserType,
          screenSizeType: syntheticMonitorResponse.screenSizeType,
        };

        itemsToSave.push(monitorMetricsByMinute);
      }
    }

    if (
      (data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
    ) {
      const customCodeMonitorResponse: CustomCodeMonitorResponse = (
        data.dataToProcess as ProbeMonitorResponse
      ).customCodeMonitorResponse!;

      const monitorMetricsByMinute: MonitorMetricsByMinute =
        new MonitorMetricsByMinute();
      monitorMetricsByMinute.monitorId = data.monitorId;
      monitorMetricsByMinute.projectId = data.projectId;
      monitorMetricsByMinute.metricType = CheckOn.ExecutionTime;
      monitorMetricsByMinute.metricValue =
        customCodeMonitorResponse.executionTimeInMS;
      monitorMetricsByMinute.miscData = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      itemsToSave.push(monitorMetricsByMinute);
    }

    await MonitorMetricsByMinuteService.createMany({
      items: itemsToSave,
      props: {
        isRoot: true,
      },
    });
  }

  private static async checkOpenIncidentsAndCloseIfResolved(input: {
    monitorId: ObjectID;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    rootCause: string;
    criteriaInstance: MonitorCriteriaInstance | null;
    dataToProcess: DataToProcess;
  }): Promise<Array<Incident>> {
    // check active incidents and if there are open incidents, do not cretae anothr incident.
    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        monitors: [input.monitorId] as any,
        currentIncidentState: {
          isResolvedState: false,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        createdCriteriaId: true,
        createdIncidentTemplateId: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    // check if should close the incident.

    for (const openIncident of openIncidents) {
      const shouldClose: boolean = MonitorResourceUtil.shouldCloseIncident({
        openIncident,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        criteriaInstance: input.criteriaInstance,
      });

      if (shouldClose) {
        // then resolve incident.
        await MonitorResourceUtil.resolveOpenIncident({
          openIncident: openIncident,
          rootCause: input.rootCause,
          dataToProcess: input.dataToProcess,
        });
      }
    }

    return openIncidents;
  }

  private static async criteriaMetCreateIncidentsAndUpdateMonitorStatus(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    dataToProcess: DataToProcess;
    rootCause: string;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
  }): Promise<void> {
    // criteria filters are met, now process the actions.

    const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
        },
        select: {
          _id: true,
          monitorStatusId: true,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    let shouldUpdateStatus: boolean = false;

    if (!lastMonitorStatusTimeline) {
      // if monitor does not have any status timeline, then create one.
      shouldUpdateStatus = true;
    }

    if (
      input.criteriaInstance.data?.changeMonitorStatus &&
      input.criteriaInstance.data?.monitorStatusId &&
      input.criteriaInstance.data?.monitorStatusId.toString() !==
        lastMonitorStatusTimeline?.id?.toString()
    ) {
      // if monitor status is changed, then create a new status timeline.
      shouldUpdateStatus = true;
    }

    // check if the current status is same as the last status.

    if (
      input.criteriaInstance.data?.changeMonitorStatus &&
      input.criteriaInstance.data?.monitorStatusId &&
      input.criteriaInstance.data?.monitorStatusId.toString() !==
        input.monitor.currentMonitorStatusId?.toString()
    ) {
      // if monitor status is changed, then create a new status timeline.
      shouldUpdateStatus = true;
    }

    if (shouldUpdateStatus) {
      logger.debug(
        `${input.monitor.id?.toString()} - Change monitor status to ${input.criteriaInstance.data?.monitorStatusId?.toString()}`,
      );
      // change monitor status

      const monitorStatusId: ObjectID | undefined =
        input.criteriaInstance.data?.monitorStatusId;

      if (!monitorStatusId) {
        throw new BadDataException("Monitor status is not defined.");
      }

      //change monitor status.

      // get last status of this monitor.

      // get last monitor status timeline.

      if (
        lastMonitorStatusTimeline &&
        lastMonitorStatusTimeline.monitorStatusId &&
        lastMonitorStatusTimeline.monitorStatusId.toString() ===
          monitorStatusId.toString()
      ) {
        // status is same as last status. do not create new status timeline.
        return;
      }

      const monitorStatusTimeline: MonitorStatusTimeline =
        new MonitorStatusTimeline();
      monitorStatusTimeline.monitorId = input.monitor.id!;
      monitorStatusTimeline.monitorStatusId = monitorStatusId;
      monitorStatusTimeline.projectId = input.monitor.projectId!;
      monitorStatusTimeline.statusChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
      monitorStatusTimeline.rootCause = input.rootCause;

      await MonitorStatusTimelineService.create({
        data: monitorStatusTimeline,
        props: {
          isRoot: true,
        },
      });
    }

    // check open incidents
    logger.debug(`${input.monitor.id?.toString()} - Check open incidents.`);
    // check active incidents and if there are open incidents, do not cretae anothr incident.
    const openIncidents: Array<Incident> =
      await this.checkOpenIncidentsAndCloseIfResolved({
        monitorId: input.monitor.id!,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        rootCause: input.rootCause,
        criteriaInstance: input.criteriaInstance,
        dataToProcess: input.dataToProcess,
      });

    if (input.criteriaInstance.data?.createIncidents) {
      // create incidents

      for (const criteriaIncident of input.criteriaInstance.data?.incidents ||
        []) {
        // should create incident.

        const alreadyOpenIncident: Incident | undefined = openIncidents.find(
          (incident: Incident) => {
            return (
              incident.createdCriteriaId ===
                input.criteriaInstance.data?.id.toString() &&
              incident.createdIncidentTemplateId ===
                criteriaIncident.id.toString()
            );
          },
        );

        const hasAlreadyOpenIncident: boolean = Boolean(alreadyOpenIncident);

        logger.debug(
          `${input.monitor.id?.toString()} - Open Incident ${alreadyOpenIncident?.id?.toString()}`,
        );

        logger.debug(
          `${input.monitor.id?.toString()} - Has open incident ${hasAlreadyOpenIncident}`,
        );

        if (hasAlreadyOpenIncident) {
          continue;
        }

        // create incident here.

        logger.debug(`${input.monitor.id?.toString()} - Create incident.`);

        const incident: Incident = new Incident();

        incident.title = criteriaIncident.title;
        incident.description = criteriaIncident.description;

        if (!criteriaIncident.incidentSeverityId) {
          // pick the critical criteria.

          const severity: IncidentSeverity | null =
            await IncidentSeverityService.findOneBy({
              query: {
                projectId: input.monitor.projectId!,
              },
              sort: {
                order: SortOrder.Ascending,
              },
              props: {
                isRoot: true,
              },
              select: {
                _id: true,
              },
            });

          if (!severity) {
            throw new BadDataException(
              "Project does not have incident severity",
            );
          } else {
            incident.incidentSeverityId = severity.id!;
          }
        } else {
          incident.incidentSeverityId = criteriaIncident.incidentSeverityId!;
        }

        incident.monitors = [input.monitor];
        incident.projectId = input.monitor.projectId!;
        incident.rootCause = input.rootCause;
        incident.createdStateLog = JSON.parse(
          JSON.stringify(input.dataToProcess, null, 2),
        );

        incident.createdCriteriaId = input.criteriaInstance.data.id.toString();

        incident.createdIncidentTemplateId = criteriaIncident.id.toString();

        incident.onCallDutyPolicies =
          criteriaIncident.onCallPolicyIds?.map((id: ObjectID) => {
            const onCallPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
            onCallPolicy._id = id.toString();
            return onCallPolicy;
          }) || [];

        incident.isCreatedAutomatically = true;

        if (input.props.telemetryQuery) {
          incident.telemetryQuery = input.props.telemetryQuery;
        }

        if (
          input.dataToProcess &&
          (input.dataToProcess as ProbeMonitorResponse).probeId
        ) {
          incident.createdByProbeId = (
            input.dataToProcess as ProbeMonitorResponse
          ).probeId;
        }

        if (criteriaIncident.remediationNotes) {
          incident.remediationNotes = criteriaIncident.remediationNotes;
        }

        await IncidentService.create({
          data: incident,
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  private static async resolveOpenIncident(input: {
    openIncident: Incident;
    rootCause: string;
    dataToProcess:
      | ProbeMonitorResponse
      | IncomingMonitorRequest
      | DataToProcess;
  }): Promise<void> {
    const resolvedStateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        input.openIncident.projectId!,
      );

    const incidentStateTimeline: IncidentStateTimeline =
      new IncidentStateTimeline();
    incidentStateTimeline.incidentId = input.openIncident.id!;
    incidentStateTimeline.incidentStateId = resolvedStateId;
    incidentStateTimeline.projectId = input.openIncident.projectId!;

    if (input.rootCause) {
      incidentStateTimeline.rootCause =
        "Incident autoresolved because autoresolve is set to true in monitor criteria. " +
        input.rootCause;
    }

    if (input.dataToProcess) {
      incidentStateTimeline.stateChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
    }

    await IncidentStateTimelineService.create({
      data: incidentStateTimeline,
      props: {
        isRoot: true,
      },
    });
  }

  private static shouldCloseIncident(input: {
    openIncident: Incident;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
  }): boolean {
    if (
      input.openIncident.createdCriteriaId?.toString() ===
      input.criteriaInstance?.data?.id.toString()
    ) {
      // same incident active. So, do not close.
      return false;
    }

    // If antoher criteria is active then, check if the incident id is present in the map.

    if (!input.openIncident.createdCriteriaId?.toString()) {
      return false;
    }

    if (!input.openIncident.createdIncidentTemplateId?.toString()) {
      return false;
    }

    if (
      input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
        input.openIncident.createdCriteriaId?.toString()
      ]
    ) {
      if (
        input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
          input.openIncident.createdCriteriaId?.toString()
        ]?.includes(input.openIncident.createdIncidentTemplateId?.toString())
      ) {
        return true;
      }
    }

    return false;
  }

  private static async processMonitorStep(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
  }): Promise<ProbeApiIngestResponse> {
    // process monitor step here.

    const criteria: MonitorCriteria | undefined =
      input.monitorStep.data?.monitorCriteria;

    if (!criteria || !criteria.data) {
      // do nothing as there's no criteria to process.
      return input.probeApiIngestResponse;
    }

    for (const criteriaInstance of criteria.data.monitorCriteriaInstanceArray) {
      const rootCause: string | null =
        await MonitorResourceUtil.processMonitorCriteiaInstance({
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          monitor: input.monitor,
          probeApiIngestResponse: input.probeApiIngestResponse,
          criteriaInstance: criteriaInstance,
        });

      if (rootCause) {
        input.probeApiIngestResponse.criteriaMetId = criteriaInstance.data?.id;
        input.probeApiIngestResponse.rootCause = `
**This incident is created because the following criteria was met**: 

**Criteria Name**: ${criteriaInstance.data?.name}
`;

        if (rootCause) {
          input.probeApiIngestResponse.rootCause += `
**Filter Conditions Met**: ${rootCause}
`;
        }

        if ((input.dataToProcess as ProbeMonitorResponse).failureCause) {
          input.probeApiIngestResponse.rootCause += `
**Cause**: ${(input.dataToProcess as ProbeMonitorResponse).failureCause || ""}
`;
        }
        break;
      }
    }

    return input.probeApiIngestResponse;
  }

  private static async processMonitorCriteiaInstance(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
  }): Promise<string | null> {
    // returns root cause if any. Otherwise criteria is not met.
    // process monitor criteria instance here.

    const rootCause: string | null =
      await MonitorResourceUtil.isMonitorInstanceCriteriaFiltersMet({
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
        monitor: input.monitor,
        probeApiIngestResponse: input.probeApiIngestResponse,
        criteriaInstance: input.criteriaInstance,
      });

    // do nothing as there's no criteria to process.
    return rootCause;
  }

  private static async isMonitorInstanceCriteriaFiltersMet(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
  }): Promise<string | null> {
    // returns root cause if any. Otherwise criteria is not met.
    let finalResult: string | null = "All filters met. ";

    if (FilterCondition.Any === input.criteriaInstance.data?.filterCondition) {
      finalResult = null; // set to false as we need to check if any of the filters are met.
    }

    for (const criteriaFilter of input.criteriaInstance.data?.filters || []) {
      const rootCause: string | null =
        await MonitorResourceUtil.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          monitor: input.monitor,
          probeApiIngestResponse: input.probeApiIngestResponse,
          criteriaInstance: input.criteriaInstance,
          criteriaFilter: criteriaFilter,
        });

      const didMeetCriteria: boolean = Boolean(rootCause);

      if (
        FilterCondition.Any === input.criteriaInstance.data?.filterCondition &&
        didMeetCriteria === true
      ) {
        finalResult = rootCause;
      }

      if (
        FilterCondition.All === input.criteriaInstance.data?.filterCondition &&
        didMeetCriteria === false
      ) {
        finalResult = null;
        break;
      }

      if (
        FilterCondition.All === input.criteriaInstance.data?.filterCondition &&
        didMeetCriteria &&
        rootCause
      ) {
        finalResult += `

        - ${rootCause}`; // in markdown format.
      }
    }

    return finalResult;
  }

  private static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // returns root cause if any. Otherwise criteria is not met.
    // process monitor criteria filter here.

    if (input.criteriaFilter.checkOn === CheckOn.JavaScriptExpression) {
      let storageMap: JSONObject = {};

      if (
        input.monitor.monitorType === MonitorType.API ||
        input.monitor.monitorType === MonitorType.Website
      ) {
        // try to parse json
        let responseBody: JSONObject | null = null;
        try {
          responseBody = JSON.parse(
            ((input.dataToProcess as ProbeMonitorResponse)
              .responseBody as string) || "{}",
          );
        } catch (err) {
          responseBody = (input.dataToProcess as ProbeMonitorResponse)
            .responseBody as JSONObject;
        }

        if (
          typeof responseBody === Typeof.String &&
          responseBody?.toString() === ""
        ) {
          // if empty string then set to empty object.
          responseBody = {};
        }

        storageMap = {
          responseBody: responseBody,
          responseHeaders: (input.dataToProcess as ProbeMonitorResponse)
            .responseHeaders,
          responseStatusCode: (input.dataToProcess as ProbeMonitorResponse)
            .responseCode,
          responseTimeInMs: (input.dataToProcess as ProbeMonitorResponse)
            .responseTimeInMs,
          isOnline: (input.dataToProcess as ProbeMonitorResponse).isOnline,
        };
      }

      if (input.monitor.monitorType === MonitorType.IncomingRequest) {
        storageMap = {
          requestBody: (input.dataToProcess as IncomingMonitorRequest)
            .requestBody,
          requestHeaders: (input.dataToProcess as IncomingMonitorRequest)
            .requestHeaders,
        };
      }

      // now evaluate the expression.
      let expression: string = input.criteriaFilter.value as string;
      expression = VMUtil.replaceValueInPlace(storageMap, expression, false); // now pass this to the VM.

      const code: string = `return Boolean(${expression});`;
      let result: ReturnResult | null = null;

      try {
        result = await VMUtil.runCodeInSandbox({
          code: code,
          options: {
            args: {},
          },
        });
      } catch (err) {
        logger.error(err);
        return null;
      }

      if (result.returnValue) {
        return `JavaScript Expression - ${expression} - evaluated to true.`;
      }

      return null; // if true then return null.
    }

    if (
      input.monitor.monitorType === MonitorType.API ||
      input.monitor.monitorType === MonitorType.Website ||
      input.monitor.monitorType === MonitorType.IP ||
      input.monitor.monitorType === MonitorType.Ping ||
      input.monitor.monitorType === MonitorType.Port
    ) {
      const apiRequestCriteriaResult: string | null =
        await APIRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (apiRequestCriteriaResult) {
        return apiRequestCriteriaResult;
      }
    }

    if (
      input.monitor.monitorType === MonitorType.CustomJavaScriptCode &&
      (input.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
    ) {
      const criteriaResult: string | null =
        await CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
          monitorResponse: (input.dataToProcess as ProbeMonitorResponse)
            .customCodeMonitorResponse!,
          criteriaFilter: input.criteriaFilter,
        });

      if (criteriaResult) {
        return criteriaResult;
      }
    }

    if (
      input.monitor.monitorType === MonitorType.SyntheticMonitor &&
      (input.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse
    ) {
      const criteriaResult: string | null =
        await SyntheticMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
          monitorResponse:
            (input.dataToProcess as ProbeMonitorResponse)
              .syntheticMonitorResponse || [],
          criteriaFilter: input.criteriaFilter,
        });

      if (criteriaResult) {
        return criteriaResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.IncomingRequest) {
      logger.debug(
        `${input.monitor.id?.toString()} - Incoming Request Monitor. Checking criteria filter.`,
      );
      //check  incoming request
      const incomingRequestResult: string | null =
        await IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (incomingRequestResult) {
        return incomingRequestResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.SSLCertificate) {
      // check server monitor
      const sslMonitorResult: string | null =
        await SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (sslMonitorResult) {
        return sslMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Server) {
      // check server monitor
      const serverMonitorResult: string | null =
        await ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (serverMonitorResult) {
        return serverMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Logs) {
      // check server monitor
      const logMonitorResult: string | null =
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (logMonitorResult) {
        return logMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Traces) {
      // check server monitor
      const traceMonitorResult: string | null =
        await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (traceMonitorResult) {
        return traceMonitorResult;
      }
    }

    return null;
  }
}
