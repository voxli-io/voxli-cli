export interface VoxliConfig {
  accessToken: string;
  apiKey?: string; // legacy backwards compat
  refreshToken?: string;
  clientId?: string;
}

export interface RegisterPayload {
  name: string;
  unique_identifier: string;
}

export interface RegisterResponse {
  test_result_ids?: string[];
  run_id?: string;
}
