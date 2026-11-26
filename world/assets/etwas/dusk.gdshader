shader_type sky;

const vec3 SUN = vec3(-0.38, 0.12, -0.917);

float mist(vec2 p) {
	vec2 cell = floor(p);
	vec2 f = smoothstep(vec2(0.0), vec2(1.0), fract(p));
	vec4 corners = fract(sin(vec4(
		dot(cell, vec2(127.1, 311.7)),
		dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7)),
		dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7)),
		dot(cell + vec2(1.0, 1.0), vec2(127.1, 311.7))
	)) * 43758.5453);
	return mix(mix(corners.x, corners.y, f.x), mix(corners.z, corners.w, f.x), f.y);
}

void sky() {
	vec3 view = normalize(EYEDIR);
	float altitude = max(view.y, 0.0);
	float sunward = max(dot(view, normalize(SUN)), 0.0);
	vec3 horizon = mix(vec3(0.66, 0.59, 0.71), vec3(1.0, 0.72, 0.53), pow(sunward, 5.0));
	vec3 sunset = mix(horizon, vec3(0.70, 0.51, 0.65), smoothstep(0.03, 0.35, altitude));
	vec3 color = mix(sunset, vec3(0.36, 0.43, 0.65), smoothstep(0.25, 0.95, altitude));

	vec2 bands = vec2(atan(view.x, -view.z) * 5.0, altitude * 38.0);
	float clouds = mist(bands) * 0.64 + mist(bands * 2.04 + 6.3) * 0.24 + mist(bands * 4.1) * 0.12;
	float cloud_opacity = smoothstep(0.49, 0.69, clouds) * smoothstep(0.02, 0.10, altitude);
	cloud_opacity *= 1.0 - smoothstep(0.52, 0.77, altitude);
	color = mix(color, mix(vec3(0.46, 0.44, 0.61), vec3(0.91, 0.55, 0.54), pow(sunward, 3.0)), cloud_opacity * 0.65);
	color += vec3(0.18, 0.079, 0.023) * pow(sunward, 65.0);
	color = mix(color, vec3(1.0, 0.95, 0.78), smoothstep(0.99972, 0.99990, sunward));
	COLOR = color;
}
