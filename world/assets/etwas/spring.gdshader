shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never;

varying vec3 surface_world;

void vertex() {
	surface_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = surface_world.xz;
	vec3 eye = normalize(CAMERA_POSITION_WORLD - surface_world);
	float wave_a = sin(dot(p, vec2(8.0, -15.2)) - TIME * 1.92);
	float wave_b = sin(dot(p, vec2(-12.6, -23.0)) + TIME * 1.29);
	float wave_c = sin(dot(p, vec2(18.3, 6.4)) - TIME * 2.61);
	vec3 normal = normalize(vec3(wave_a * 0.043 + wave_c * 0.021, 1.0, wave_b * 0.038 - wave_c * 0.018));
	vec3 bounce = reflect(-eye, normal);
	float fresnel = pow(1.0 - max(dot(eye, normal), 0.0), 2.7);
	vec3 reflected_sky = mix(vec3(0.82, 0.57, 0.50), vec3(0.41, 0.51, 0.65), smoothstep(0.05, 0.57, bounce.y));
	float sun_glint = pow(max(dot(bounce, normalize(vec3(-0.38, 0.12, -0.917))), 0.0), 45.0);
	float ripples = (wave_a + wave_b + wave_c) * 0.018;
	ALBEDO = mix(vec3(0.31, 0.57, 0.55) + ripples, reflected_sky, 0.24 + fresnel * 0.68);
	ALBEDO += vec3(0.56, 0.32, 0.14) * sun_glint;
	ALPHA = mix(0.37, 0.85, fresnel);
}
