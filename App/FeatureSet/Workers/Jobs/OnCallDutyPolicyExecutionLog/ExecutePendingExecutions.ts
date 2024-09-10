import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import logger from "Common/Server/Utils/Logger";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import IncidentService from "Common/Server/Services/IncidentService";

RunCron(
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    // get all pending on-call executions and execute them all at once.

    const pendingExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          status: OnCallDutyPolicyStatus.Executing,
        },
        select: {
          _id: true,
          projectId: true,
          onCallDutyPolicyId: true,
          lastEscalationRuleExecutedAt: true,
          lastExecutedEscalationRuleId: true,
          lastExecutedEscalationRuleOrder: true,
          executeNextEscalationRuleInMinutes: true,
          userNotificationEventType: true,
          triggeredByIncidentId: true,
          createdAt: true,
          onCallDutyPolicy: {
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
          },
          onCallPolicyExecutionRepeatCount: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const promises: Array<Promise<void>> = [];

    for (const executionLog of pendingExecutions) {
      promises.push(executeOnCallPolicy(executionLog));
    }

    await Promise.allSettled(promises);
  },
);


type ExecuteOnCallPolicyFunction = (
  executionLog: OnCallDutyPolicyExecutionLog,
) => Promise<void>;

const executeOnCallPolicy: ExecuteOnCallPolicyFunction = async (
  executionLog: OnCallDutyPolicyExecutionLog,
): Promise<void> => {
  try {

    // get trigger by incident
    if(executionLog.triggeredByIncidentId){
      // check if this incident is ack. 
      const isAcknowledged: boolean = await IncidentService.isIncidentAcknowledged({
        incidentId: executionLog.triggeredByIncidentId
      }); 

      if(isAcknowledged){
        // then mark this policy as executed. 
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: executionLog.id!,
          data: {
            status: OnCallDutyPolicyStatus.Completed
          },
          props: {
            isRoot: true
          }
        })

        return; 
      }
    }


    // check if this execution needs to be executed.

    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const lastExecutedAt: Date =
      executionLog.lastEscalationRuleExecutedAt || executionLog.createdAt!;

    const getDifferenceInMinutes: number = OneUptimeDate.getDifferenceInMinutes(
      lastExecutedAt,
      currentDate,
    );

    if (
      getDifferenceInMinutes <
      (executionLog.executeNextEscalationRuleInMinutes || 0)
    ) {
      return;
    }

    // get the next escalation rule to execute.
    const nextEscalationRule: OnCallDutyPolicyEscalationRule | null =
      await OnCallDutyPolicyEscalationRuleService.findOneBy({
        query: {
          projectId: executionLog.projectId!,
          onCallDutyPolicyId: executionLog.onCallDutyPolicyId!,
          order: executionLog.lastExecutedEscalationRuleOrder! + 1,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!nextEscalationRule) {
      // check if we need to repeat this execution.

      if (
        executionLog.onCallPolicyExecutionRepeatCount &&
        executionLog.onCallPolicyExecutionRepeatCount <
          executionLog.onCallDutyPolicy!
            .repeatPolicyIfNoOneAcknowledgesNoOfTimes!
      ) {
        // repeating execution

        const newRepeatCount: number =
          executionLog.onCallPolicyExecutionRepeatCount + 1;

        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: executionLog.id!,
          data: {
            onCallPolicyExecutionRepeatCount: newRepeatCount,
          },
          props: {
            isRoot: true,
          },
        });

        // get first escalation rule.

        const firstEscalationRule: OnCallDutyPolicyEscalationRule | null =
          await OnCallDutyPolicyEscalationRuleService.findOneBy({
            query: {
              projectId: executionLog.projectId!,
              onCallDutyPolicyId: executionLog.onCallDutyPolicyId!,
              order: 1,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
            },
          });

        if (!firstEscalationRule) {
          // mark this as complete.
          await OnCallDutyPolicyExecutionLogService.updateOneById({
            id: executionLog.id!,
            data: {
              status: OnCallDutyPolicyStatus.Completed,
              statusMessage: "Execution completed.",
            },
            props: {
              isRoot: true,
            },
          });

          return;
        }

        // update the execution log.
        await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
          firstEscalationRule.id!,
          {
            projectId: executionLog.projectId!,
            triggeredByIncidentId: executionLog.triggeredByIncidentId,
            userNotificationEventType: executionLog.userNotificationEventType!,
            onCallPolicyExecutionLogId: executionLog.id!,
            onCallPolicyId: executionLog.onCallDutyPolicyId!,
          },
        );

        return;
      }
      // mark this as complete as we have no rules to execute.
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: "Execution completed.",
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }
    await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
      nextEscalationRule!.id!,
      {
        projectId: executionLog.projectId!,
        triggeredByIncidentId: executionLog.triggeredByIncidentId,
        userNotificationEventType: executionLog.userNotificationEventType!,
        onCallPolicyExecutionLogId: executionLog.id!,
        onCallPolicyId: executionLog.onCallDutyPolicyId!,
      },
    );

    return;
  } catch (err: any) {
    logger.error(err);

    // update this log with error message.
    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: executionLog.id!,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage:
          err.message || "Error occurred while executing the on-call policy.",
      },
      props: {
        isRoot: true,
      },
    });
  }
};
