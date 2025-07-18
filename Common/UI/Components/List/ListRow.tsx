import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import Button, { ButtonSize } from "../Button/Button";
import Detail from "../Detail/Detail";
import Field from "../Detail/Field";
import Icon, { ThickProp } from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useState, useEffect } from "react";
import { Draggable, DraggableProvided } from "react-beautiful-dnd";

export interface ListDetailProps {
  showDetailsInNumberOfColumns?: number | undefined;
}

export interface ComponentProps<T extends GenericObject> {
  item: T;
  fields: Array<Field<T>>;
  actionButtons?: Array<ActionButtonSchema<T>> | undefined;
  enableDragAndDrop?: boolean | undefined;
  dragAndDropScope?: string | undefined;
  dragDropIdField?: keyof T | undefined;
  dragDropIndexField?: keyof T | undefined;
  listDetailOptions?: ListDetailProps | undefined;
}

type ListRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const ListRow: ListRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const [isButtonLoading, setIsButtonLoading] = useState<Array<boolean>>(
    props.actionButtons?.map(() => {
      return false;
    }) || [],
  );

  const [error, setError] = useState<string>("");

  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  type GetRowFunction = (provided?: DraggableProvided) => ReactElement;

  const getRow: GetRowFunction = (
    provided?: DraggableProvided,
  ): ReactElement => {
    return (
      <div
        {...provided?.draggableProps}
        ref={provided?.innerRef}
        className="bg-white px-4 py-6 shadow sm:rounded-lg sm:px-6"
      >
        <div>
          {props.enableDragAndDrop && (
            <div className="flex">
              <div className="ml-0 -ml-2 w-10" {...provided?.dragHandleProps}>
                <Icon
                  icon={IconProp.Drag}
                  thick={ThickProp.Thick}
                  className=" h-6 w-6 text-gray-500 hover:text-gray-700 m-auto cursor-ns-resize"
                />
              </div>
              <Detail
                item={props.item}
                fields={props.fields}
                showDetailsInNumberOfColumns={
                  props.listDetailOptions?.showDetailsInNumberOfColumns || 1
                }
              />
            </div>
          )}
          {!props.enableDragAndDrop && (
            <Detail
              item={props.item}
              fields={props.fields}
              showDetailsInNumberOfColumns={
                props.listDetailOptions?.showDetailsInNumberOfColumns || 1
              }
            />
          )}
        </div>

        <div
          className={
            props.enableDragAndDrop ? `flex mt-5 ml-5` : `flex mt-5 -ml-3`
          }
        >
          {props.actionButtons?.map(
            (button: ActionButtonSchema<T>, i: number) => {
              if (button.isVisible && !button.isVisible(props.item)) {
                return <></>;
              }

              // Hide button on mobile if hideOnMobile is true
              if (button.hideOnMobile && isMobile) {
                return <></>;
              }

              return (
                <div key={i}>
                  <Button
                    buttonSize={ButtonSize.Small}
                    title={button.title}
                    icon={button.icon}
                    buttonStyle={button.buttonStyleType}
                    isLoading={isButtonLoading[i]}
                    onClick={() => {
                      if (button.onClick) {
                        isButtonLoading[i] = true;
                        setIsButtonLoading(isButtonLoading);
                        button.onClick(
                          props.item,
                          () => {
                            // on action complete
                            isButtonLoading[i] = false;
                            setIsButtonLoading(isButtonLoading);
                          },
                          (err: Error) => {
                            isButtonLoading[i] = false;
                            setIsButtonLoading(isButtonLoading);
                            setError((err as Error).message);
                          },
                        );
                      }
                    }}
                  />
                </div>
              );
            },
          )}
        </div>
        {error && (
          <ConfirmModal
            title={`Error`}
            description={error}
            submitButtonText={"Close"}
            onSubmit={() => {
              return setError("");
            }}
          />
        )}
      </div>
    );
  };

  if (
    props.enableDragAndDrop &&
    props.dragDropIdField &&
    props.dragDropIndexField
  ) {
    return (
      <Draggable
        draggableId={(props.item[props.dragDropIdField] as string) || ""}
        index={(props.item[props.dragDropIndexField] as number) || 0}
      >
        {(provided: DraggableProvided) => {
          return getRow(provided);
        }}
      </Draggable>
    );
  }

  return getRow();
};

export default ListRow;
