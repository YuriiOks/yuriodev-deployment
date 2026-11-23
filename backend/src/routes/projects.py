"""REST routes of the projects (user-created dashboards), under /api/dashboards/v1.

Same gate, error shape and task rules as the spaces' routes (`routes/dashboards.py`); the data is
in each project's own schema (`src/dashboards/projects.py`). An id that is not a valid project id
is a 404 before any query; writes to an archived project are 409 `project_archived`.
"""

from typing import Annotated

from fastapi import APIRouter, Query, Response

from src.dashboards import projects as project_service
from src.dashboards.catalog import TaskStatusFilter
from src.dashboards.schemas import (
    ProjectCreate,
    ProjectOut,
    ProjectPatch,
    ProjectsOut,
    ProjectTaskOut,
    ProjectTasksOut,
    TaskCreate,
    TaskPatch,
)
from src.routes.dashboards import ClockDep, SessionDep, ZoneDep

router = APIRouter(prefix="/api/dashboards/v1", tags=["projects"])


@router.get("/projects")
async def list_projects(session: SessionDep, clock: ClockDep, zone: ZoneDep) -> ProjectsOut:
    today = clock().astimezone(zone).date()
    return ProjectsOut(projects=await project_service.list_projects(session, today))


@router.post("/projects", status_code=201)
async def create_project(body: ProjectCreate, session: SessionDep, clock: ClockDep) -> ProjectOut:
    return await project_service.create_project(session, body.name, clock())


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: str, body: ProjectPatch, session: SessionDep, clock: ClockDep, zone: ZoneDep
) -> ProjectOut:
    today = clock().astimezone(zone).date()
    return await project_service.update_project(session, project_id, body, today)


@router.get("/projects/{project_id}/tasks")
async def list_project_tasks(
    project_id: str, session: SessionDep, status: Annotated[TaskStatusFilter, Query()] = "open"
) -> ProjectTasksOut:
    tasks = await project_service.list_project_tasks(session, project_id, status)
    return ProjectTasksOut(tasks=tasks)


@router.post("/projects/{project_id}/tasks", status_code=201)
async def create_project_task(
    project_id: str, body: TaskCreate, session: SessionDep, clock: ClockDep
) -> ProjectTaskOut:
    return await project_service.create_project_task(session, project_id, body, "web", clock())


@router.patch("/projects/{project_id}/tasks/{task_id}")
async def update_project_task(
    project_id: str, task_id: str, body: TaskPatch, session: SessionDep, clock: ClockDep
) -> ProjectTaskOut:
    return await project_service.update_project_task(session, project_id, task_id, body, clock())


@router.delete("/projects/{project_id}/tasks/{task_id}", status_code=204)
async def delete_project_task(project_id: str, task_id: str, session: SessionDep) -> Response:
    await project_service.delete_project_task(session, project_id, task_id)
    return Response(status_code=204)
