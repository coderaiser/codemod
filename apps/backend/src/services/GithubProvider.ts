import axios, { type AxiosResponse } from 'axios';
import gh from 'parse-github-url';
import type {
	Assignee,
	CreatePRParams,
	GHBranch,
	GithubContent,
	GithubRepository,
	Issue,
	ListPRParams,
	NewIssueParams,
	PullRequest,
	SourceControlProvider,
} from './SourceControl.js';

type Repository = {
	owner: string;
	name: string;
};

class InvalidGithubUrlError extends Error {}
class ParseGithubUrlError extends Error {}

function parseGithubRepoUrl(url: string): Repository {
	try {
		const { owner, name } = gh(url) ?? {};

		if (!owner || !name) {
			throw new InvalidGithubUrlError('Missing owner or name');
		}

		return { owner, name };
	} catch (e) {
		if (e instanceof InvalidGithubUrlError) {
			throw e;
		}

		const errorMessage = e instanceof Error ? e.message : String(e);
		throw new ParseGithubUrlError(errorMessage);
	}
}

const withPagination = async (
	paginatedRequest: (page: string) => Promise<AxiosResponse<any[]>>,
) => {
	const nextPattern = /(?<=<)([\S]*)(?=>; rel="Next")/i;
	let nextPage: string | null = '1';
	let data: any[] = [];

	while (nextPage !== null) {
		const response = await paginatedRequest(nextPage);
		data = [...data, ...(response.data ?? [])];

		const linkHeader = response.headers.link;

		if (
			typeof linkHeader === 'string' &&
			linkHeader.includes(`rel=\"next\"`)
		) {
			const nextUrl = linkHeader.match(nextPattern)?.[0];
			nextPage = nextUrl
				? new URL(nextUrl).searchParams.get('page')
				: null;
		} else {
			nextPage = null;
		}
	}

	return data;
};

const PER_PAGE = 99;

export class GithubProvider implements SourceControlProvider {
	private readonly __repo: string | null = null;
	private readonly __baseUrl: string;
	private readonly __authHeader: string;

	constructor(oAuthToken: string, repoUrl: string | null) {
		this.__baseUrl = 'https://api.github.com';
		this.__repo = repoUrl;
		this.__authHeader = `Bearer ${oAuthToken}`;
	}

	private get __repoUrl() {
		const { owner, name } = parseGithubRepoUrl(this.__repo ?? '');

		return `${this.__baseUrl}/repos/${owner}/${name}`;
	}

	async createIssue(params: NewIssueParams): Promise<Issue> {
		const response = await fetch(`${this.__repoUrl}/issues`, {
			method: 'POST',
			headers: {
				Authorization: this.__authHeader,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(params),
		});
		if (!response.ok) throw new Error('Network response was not ok');
		const res = { data: (await response.json()) as Issue };

		return res.data;
	}

	async createPullRequest(params: CreatePRParams): Promise<PullRequest> {
		const response = await fetch(`${this.__repoUrl}/pulls`, {
			method: 'POST',
			headers: {
				Authorization: this.__authHeader,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(params),
		});
		if (!response.ok) throw new Error('Network response was not ok');
		const res = { data: (await response.json()) as PullRequest };

		return res.data;
	}

	async getPullRequests(params: ListPRParams): Promise<PullRequest[]> {
		const queryParams = Object.entries(params).reduce<
			Record<string, string>
		>((acc, [key, value]) => {
			if (value) {
				acc[key] = value;
			}

			return acc;
		}, {});

		const query = new URLSearchParams(queryParams).toString();

		const response = await fetch(`${this.__repoUrl}/pulls?${query}`, {
			headers: { Authorization: this.__authHeader },
		});
		if (!response.ok) throw new Error('Network response was not ok');
		const res = { data: (await response.json()) as PullRequest[] };

		return res.data;
	}

	async getAssignees(): Promise<Assignee[]> {
		const response = await fetch(`${this.__repoUrl}/assignees`, {
			headers: { Authorization: this.__authHeader },
		});
		if (!response.ok) throw new Error('Network response was not ok');
		const res = { data: (await response.json()) as Assignee[] };

		return res.data;
	}

	private __getUserRepositories = async (
		page: string,
	): Promise<AxiosResponse<GithubRepository[]>> => {
		return await axios.get<GithubRepository[]>(
			`https://api.github.com/user/repos?per_page=${PER_PAGE}&page=${page}`,
			{
				headers: {
					Authorization: this.__authHeader,
				},
			},
		);
	};

	async getUserRepositories(): Promise<GithubRepository[]> {
		return await withPagination(this.__getUserRepositories);
	}

	private __getBranches = async (
		page: string,
	): Promise<AxiosResponse<GHBranch[]>> => {
		const response = await fetch(
			`${this.__repoUrl}/branches?per_page=${PER_PAGE}&page=${page}`,
			{ headers: { Authorization: this.__authHeader } },
		);
		if (!response.ok) throw new Error('Network response was not ok');
		return { data: (await response.json()) as GHBranch[] };
	};

	async getBranches(): Promise<string[]> {
		return await withPagination(this.__getBranches);
	}

	async getRepoContents(branchName: string): Promise<GithubContent[]> {
		const response = await fetch(
			`${this.__repoUrl}/contents?ref=${branchName}`,
			{ headers: { Authorization: this.__authHeader } },
		);
		if (!response.ok) throw new Error('Network response was not ok');
		const res = { data: (await response.json()) as GithubContent[] };

		return res.data;
	}
}
